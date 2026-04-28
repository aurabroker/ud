"""
Local Graph Service — Zep Cloud replacement using LLM + JSON file storage.
Used automatically when ZEP_API_KEY is not configured.
"""

import os
import json
import uuid
import threading
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ..config import Config
from ..utils.logger import get_logger
from ..utils.llm_client import LLMClient

logger = get_logger('mirofish.local_graph')

GRAPHS_DIR = os.path.join(os.path.dirname(__file__), '../../uploads/graphs')
_lock = threading.Lock()


def _ensure_dir():
    os.makedirs(GRAPHS_DIR, exist_ok=True)


def _graph_path(graph_id: str) -> str:
    return os.path.join(GRAPHS_DIR, f"{graph_id}.json")


def _load(graph_id: str) -> Dict:
    path = _graph_path(graph_id)
    if not os.path.exists(path):
        return {}
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _save(graph_id: str, data: Dict):
    _ensure_dir()
    with open(_graph_path(graph_id), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Data classes that mimic Zep Cloud SDK objects ──────────────────────────

@dataclass
class NodeLike:
    uuid_: str
    name: str
    labels: List[str] = field(default_factory=list)
    summary: str = ""
    attributes: Dict[str, Any] = field(default_factory=dict)
    created_at: Optional[str] = None


@dataclass
class EdgeLike:
    uuid_: str
    name: str
    fact: str
    source_node_uuid: str
    target_node_uuid: str
    fact_type: str = ""
    attributes: Dict[str, Any] = field(default_factory=dict)
    episodes: List[str] = field(default_factory=list)
    created_at: Optional[str] = None
    valid_at: Optional[str] = None
    invalid_at: Optional[str] = None
    expired_at: Optional[str] = None


@dataclass
class EpisodeLike:
    uuid_: str
    processed: bool = True


@dataclass
class SearchResultLike:
    edges: List[EdgeLike] = field(default_factory=list)
    nodes: List[NodeLike] = field(default_factory=list)


# ── Nested operation classes ───────────────────────────────────────────────

class _EpisodeOps:
    def get(self, uuid_: str) -> EpisodeLike:
        return EpisodeLike(uuid_=uuid_, processed=True)


class _NodeOps:
    def get_by_graph_id(
        self,
        graph_id: str,
        limit: int = 100,
        uuid_cursor: Optional[str] = None,
    ) -> List[NodeLike]:
        data = _load(graph_id)
        nodes = data.get('nodes', [])
        if uuid_cursor:
            for i, n in enumerate(nodes):
                if n['uuid_'] == uuid_cursor:
                    nodes = nodes[i + 1:]
                    break
        return [_node_from_dict(n) for n in nodes[:limit]]

    def get(self, uuid_: str = "", graph_id: str = "", **kwargs) -> Optional[NodeLike]:
        uid = uuid_ or kwargs.get('uuid_', '')
        # Search across all graphs
        _ensure_dir()
        for fname in os.listdir(GRAPHS_DIR):
            if not fname.endswith('.json'):
                continue
            gid = fname[:-5]
            data = _load(gid)
            for n in data.get('nodes', []):
                if n['uuid_'] == uid:
                    return _node_from_dict(n)
        return None

    def get_entity_edges(self, node_uuid: str) -> List[EdgeLike]:
        _ensure_dir()
        result = []
        for fname in os.listdir(GRAPHS_DIR):
            if not fname.endswith('.json'):
                continue
            data = _load(fname[:-5])
            for e in data.get('edges', []):
                if e.get('source_node_uuid') == node_uuid or e.get('target_node_uuid') == node_uuid:
                    result.append(_edge_from_dict(e))
        return result


class _EdgeOps:
    def get_by_graph_id(
        self,
        graph_id: str,
        limit: int = 100,
        uuid_cursor: Optional[str] = None,
    ) -> List[EdgeLike]:
        data = _load(graph_id)
        edges = data.get('edges', [])
        if uuid_cursor:
            for i, e in enumerate(edges):
                if e['uuid_'] == uuid_cursor:
                    edges = edges[i + 1:]
                    break
        return [_edge_from_dict(e) for e in edges[:limit]]


class _GraphOps:
    def __init__(self):
        self.episode = _EpisodeOps()
        self.node = _NodeOps()
        self.edge = _EdgeOps()

    def create(self, graph_id: str, name: str = "", description: str = "", **kwargs):
        with _lock:
            _save(graph_id, {
                'graph_id': graph_id,
                'name': name,
                'description': description,
                'ontology': {},
                'nodes': [],
                'edges': [],
            })
        logger.info(f"Local graph created: {graph_id}")

    def set_ontology(self, graph_ids: List[str], entities=None, edges=None, **kwargs):
        for gid in graph_ids:
            with _lock:
                data = _load(gid)
                entity_info = {}
                if entities:
                    for name, cls in entities.items():
                        entity_info[name] = getattr(cls, '__doc__', None) or name
                edge_info = {}
                if edges:
                    for name, (cls, source_targets) in edges.items():
                        edge_info[name] = {
                            'description': getattr(cls, '__doc__', None) or name,
                            'source_targets': [
                                {'source': st.source, 'target': st.target}
                                for st in source_targets
                            ],
                        }
                data['ontology'] = {'entities': entity_info, 'edges': edge_info}
                _save(gid, data)

    def add_batch(self, graph_id: str, episodes: List[Any], **kwargs) -> List[EpisodeLike]:
        texts = [ep.data for ep in episodes if hasattr(ep, 'data') and ep.data]
        ep_id = str(uuid.uuid4())
        results = [EpisodeLike(uuid_=ep_id, processed=True)]

        if not texts:
            return results

        combined = "\n\n".join(texts)
        with _lock:
            data = _load(graph_id)
        ontology = data.get('ontology', {})

        try:
            extracted = _extract_with_llm(combined, ontology)
            _merge_extracted(graph_id, extracted, ep_id)
        except Exception as exc:
            logger.warning(f"Entity extraction failed ({graph_id}): {exc}")

        return results

    def add(self, graph_id: str, type: str = "text", data: str = "", **kwargs):
        ep_id = str(uuid.uuid4())
        if not data:
            return
        with _lock:
            gdata = _load(graph_id)
        ontology = gdata.get('ontology', {})
        try:
            extracted = _extract_with_llm(data, ontology)
            _merge_extracted(graph_id, extracted, ep_id)
        except Exception as exc:
            logger.warning(f"add() extraction failed ({graph_id}): {exc}")

    def delete(self, graph_id: str, **kwargs):
        path = _graph_path(graph_id)
        if os.path.exists(path):
            os.remove(path)
        logger.info(f"Local graph deleted: {graph_id}")

    def search(
        self,
        graph_id: str,
        query: str,
        limit: int = 10,
        scope: str = "edges",
        num_results: int = 10,
        **kwargs,
    ) -> SearchResultLike:
        n = limit or num_results
        data = _load(graph_id)
        nodes = data.get('nodes', [])
        edges = data.get('edges', [])
        node_map = {n_['uuid_']: n_ for n_ in nodes}

        ql = query.lower()
        words = [w for w in ql.split() if len(w) > 2]

        scored = []
        for e in edges:
            text = f"{e.get('fact', '')} {e.get('name', '')}".lower()
            src_name = node_map.get(e.get('source_node_uuid', ''), {}).get('name', '').lower()
            tgt_name = node_map.get(e.get('target_node_uuid', ''), {}).get('name', '').lower()
            full = f"{text} {src_name} {tgt_name}"
            score = sum(1 for w in words if w in full)
            if score > 0:
                scored.append((score, e))

        scored.sort(key=lambda x: -x[0])
        result = SearchResultLike()
        for _, e in scored[:n]:
            result.edges.append(_edge_from_dict(e))
        return result


class LocalZepClient:
    """Drop-in replacement for zep_cloud.client.Zep when ZEP_API_KEY is absent."""

    def __init__(self, **kwargs):
        self.graph = _GraphOps()


# ── Helpers ────────────────────────────────────────────────────────────────

def _node_from_dict(n: Dict) -> NodeLike:
    return NodeLike(
        uuid_=n['uuid_'],
        name=n.get('name', ''),
        labels=n.get('labels', []),
        summary=n.get('summary', ''),
        attributes=n.get('attributes', {}),
        created_at=n.get('created_at'),
    )


def _edge_from_dict(e: Dict) -> EdgeLike:
    return EdgeLike(
        uuid_=e['uuid_'],
        name=e.get('name', ''),
        fact=e.get('fact', ''),
        source_node_uuid=e.get('source_node_uuid', ''),
        target_node_uuid=e.get('target_node_uuid', ''),
        fact_type=e.get('fact_type', ''),
        attributes=e.get('attributes', {}),
        episodes=e.get('episodes', []),
        created_at=e.get('created_at'),
        valid_at=e.get('valid_at'),
        invalid_at=e.get('invalid_at'),
        expired_at=e.get('expired_at'),
    )


def _merge_extracted(graph_id: str, extracted: Dict, ep_id: str):
    with _lock:
        data = _load(graph_id)
        now = _now()
        name_to_uuid: Dict[str, str] = {
            n['name'].lower(): n['uuid_'] for n in data.get('nodes', [])
        }
        existing_names = set(name_to_uuid.keys())

        for entity in extracted.get('entities', []):
            name = entity.get('name', '').strip()
            if not name or name.lower() in existing_names:
                continue
            nid = str(uuid.uuid4())
            name_to_uuid[name.lower()] = nid
            existing_names.add(name.lower())
            data.setdefault('nodes', []).append({
                'uuid_': nid,
                'name': name,
                'labels': [entity.get('type', 'Entity'), 'Entity'],
                'summary': entity.get('summary', ''),
                'attributes': entity.get('attributes', {}),
                'created_at': now,
            })

        for rel in extracted.get('relationships', []):
            src_id = name_to_uuid.get(rel.get('source', '').lower())
            tgt_id = name_to_uuid.get(rel.get('target', '').lower())
            if not src_id or not tgt_id:
                continue
            data.setdefault('edges', []).append({
                'uuid_': str(uuid.uuid4()),
                'name': rel.get('type', 'RELATED_TO'),
                'fact': rel.get('fact', ''),
                'fact_type': rel.get('type', 'RELATED_TO'),
                'source_node_uuid': src_id,
                'target_node_uuid': tgt_id,
                'attributes': {},
                'episodes': [ep_id],
                'created_at': now,
                'valid_at': now,
                'invalid_at': None,
                'expired_at': None,
            })

        _save(graph_id, data)
        logger.info(
            f"Local graph {graph_id}: "
            f"+{len(extracted.get('entities', []))} entities, "
            f"+{len(extracted.get('relationships', []))} relationships"
        )


def _extract_with_llm(text: str, ontology: Dict) -> Dict:
    entity_types = list(ontology.get('entities', {}).keys())
    edge_types = list(ontology.get('edges', {}).keys())

    e_list = ', '.join(entity_types) if entity_types else 'Person, Organization, Location, Event, Concept'
    r_list = ', '.join(edge_types) if edge_types else 'RELATED_TO, WORKS_FOR, LOCATED_IN'

    prompt = (
        f"Extract entities and relationships from the text below.\n\n"
        f"Entity types: {e_list}\n"
        f"Relationship types: {r_list}\n\n"
        "Return ONLY a JSON object:\n"
        '{"entities":[{"name":"...","type":"...","summary":"...","attributes":{}}],'
        '"relationships":[{"source":"...","target":"...","type":"...","fact":"..."}]}\n\n'
        f"Text:\n{text[:3000]}"
    )

    try:
        client = LLMClient()
        raw = client.chat([{"role": "user", "content": prompt}], temperature=0.1, max_tokens=2048)
        content = raw.strip()
        if '```json' in content:
            content = content.split('```json')[1].split('```')[0].strip()
        elif '```' in content:
            content = content.split('```')[1].split('```')[0].strip()
        return json.loads(content)
    except Exception as exc:
        logger.warning(f"LLM extraction error: {exc}")
        return {"entities": [], "relationships": []}
