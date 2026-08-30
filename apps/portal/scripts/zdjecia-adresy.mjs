/**
 * Adresy zdjęć na CDN-ie Artlista, wygenerowanych 2026-08-30 modelem
 * Seedream 5.0 (21:9, 2K) ze style kitu „UtrataDochodu.pl — zdjęcia kategorii".
 * Podpisy w adresach ważne do 2036 r.
 *
 * Klucz to nazwa pliku bez rozszerzenia, czyli slug kategorii albo zawodu.
 * Używa tego scripts/pobierz-zdjecia.mjs.
 */

const CDN = 'https://cms-toolkit-artifacts.artlist.io/content/-t-e-x-t_-t-o_-i-m-a-g-e-v1';
const plik = (katalog, id, wygasa, podpis) =>
  `${CDN}/${katalog}/-t-e-x-t_-t-o_-i-m-a-g-e-${id}.jpeg`
  + `?Expires=${wygasa}&Key-Pair-Id=K2ZDLYDZI2R1DF&Signature=${podpis}`;

export const KATEGORIE = {
  medycyna: plik('media__10', '8f5137f4-8588-40da-9df0-0341f567e35a', 2103440817,
    'QU1Mo-EvdQlaxo9LRf9yDm4kh~EUvlmHuhwDNMxpHjLmz6Vg4CyjeHP0cd07v0T0uWkIXKmyRDyV8I1Qd-Ojoz1A4NBWaU0P5XnFlpVbPPgk~Vhca2qrmc2i5qx9lgHXiozE8dedaajnRayNQ~L3jQ13ML5PtulhDrQTTYFWN-raIUJkYKw8YzZ2GMNQQaBzaWnAG1eN0jWNNAZ2UQb-O5nVej4OLtnyhs3OB~m~tyalFbXruxWWeV6VkHoYFfEETpOESFZUgcoHM95EiTY1Mf2VRGhrKJ3IV2sx0ge0Ir~yj-7rsr0HHecn3Vn-Ux5c2GoWl7Tv6SrT2wq2IRXSFQ__'),
  'it-tech': plik('media__3', 'c353525a-8c9b-4faf-aa47-36f7ae72e5e7', 2103440899,
    'eOUae9lWYOW9Rb4mMLBU9OHX4sZ4J2~E-m-LuOdPbPcPrZW67kvFLRVNksjz66IaP-wZjmaKj7TpEaok42oSH6ETRo44Lx~lajMdbd8aWOOsASrx7P~U0MHxWtDC-ZN5Z~BrK~5PxLwctcdXJQJkIpPeyja2iaBkGG7DzgKTcXNGolW41r2HtbKjOIVK13Ps1JCKjf1piT3zYgEEOkQQUVLWqbqMId9Hq2Ywdl7SsoUcSfHjupSz-0Ps1~fAkb4TyZktrCaPFBposYmTG5Tf88d9s9Rtz4t3EQC4S6mC8qdVUrHo2d6vFVewOZ-gjAUhHKaaqp-sc46SIz8UppbzPQ__'),
  finanse: plik('media__1', '186121db-262b-4bb5-8ce8-104f2a4e1b1f', 2103440899,
    'KeAsZxlElyyr-9WuZVdAfps524xu0Bt4OXECSoB-5NBFoQKXVAfcYZqqr4k72VaWFFlJJ6mUwbQZGcYfskQ170I3Nejz5A74Xdp894YNZIhnLaORpsCg668okPVlTD2-Kq7LwOVbjWowj-GTUC6uqVFjW0umSvIWNcKgnGOzmwF6Ioumgc9IicTOCS3OyAwSUy3wJeatKojtQjNh5g0QqkNDAUMY0LOIL8yAuWjOaoK2lqEWw61libCZ3G429BSqEF85DpffNevcbpygcBSQoczkpU2XfB5~yjCBXVp83tJAK5VyLYdV3m7OdOZVgHx~-6G1~DnohKReRbt8wudQjQ__'),
  biznes: plik('media__2', '6cee8654-21ae-4b89-b519-71ada8d6219b', 2103440899,
    '0s03H1XXfeoslmG5bPriWxsqXW-RQwBLynxDQHRLWZV-udw5Jj9~Kr-WIF6rnifcx0kOZv463wHWSPcSPEZMcDU5JzhqXwOp-iD22vhbSsYkTI8DGGikPZE980vwD8gzKEjhV~slnErh6GzSp6k0qYrAuIoWljEOuL7sW7MeaQMEceVqd75BBvZpD7mTvvFwr1c1hxZpDUqpcwPC~R~eGShqMZ~6vcD2nq2XWxKSvkRGhdlNkL-NBodTFJHQAk3RSxb15vdZE0ytyB5zbdjjAS0TArIV7Ua98-dllo-UH5l5ZCMpqcIq~lxvRZwe8msCORnmqFjICJ3divR9yvbY9Q__'),
  pielegniarstwo: plik('media__7', '2489da53-188a-49f2-b41c-b1502c6191a3', 2103440899,
    'TJKxB23TdqAc71O5UV97YYOEFv1JmLZG75j9PafT3Bvshwyz5Vml4BPmT1Gss8Te0yQBaUNP3i3D-dNADfv1tcQgJLfHdciUCo2Df-pflPSkayTLdvM-N~j-7kiPu~afFE4TqaBtjdN69Epq6BLzArI6Vh0b2Xu0opJC19rAAwwEYa5v-zSIipgCW7yFdrD~J0zdqLfMTxOTnRAeDt8GruYShVGspQYP-s-LE0TwJZMuaP6uarc07WeHjqUBIdV33yizU0nowgn3-6EB~L1XIYIXNoE-4Y6aziX~yPxgAYtyFyE12grkThyvLvS74MwdOCShYAzUpgbWNv8CvlagDA__'),
  'sztuka-media': plik('media__5', '12b29a63-57ee-46f5-937c-fab67a56f12f', 2103440907,
    'HXuHqlFzL1v~uu8f3oh~1Fhq~ulY~SCZJBxY3H~OcZRHp6dOU68O~XwANK1e5ov15kG7VZwFyCkE9kt2HgvgeqcO9ZFO5XmDnz-LO9PDJk-mS5pmqIZuF7AoW-J49MLufb2GeOslTcD4PO4EIuQ35g8gcgdlzj0WI9nqWhKxrAXJP1~ubbWg-mD-dOg1T~hTv-a-YZJMnzYyF9ycuwzBoVeWhTkQpNxPvNMOEia5pNnhBsS9wx-nqeYpjS9S9cFqhJIyXfXjBMDZDhIpLFrEb~duQu1fL7CneG6S5FYcsRorXrmuczG4mOvrYbtvwqffw6KMP8W7O7BDijn5x-8zjg__'),
  budownictwo: plik('media__7', '4c74d064-7820-48f3-aa92-a91dd221a7c0', 2103440899,
    'CShPGjmG7~bW46INR41iNJq~pW2fRx2TfLjNGgtyOyKR5sIqjRtnTnB-YknfnuzyCfReJzLVAtfLngC~Dgcz70IAvJp7o0aCUmX6g6PgJWrkCG5fT8qZsApWvGpKpB2dCItLTqeD5Mpr1g0xHa36FjiuFOR8IhjKfLAYybhZgV-QJZIbERpVXTT37PvUJVrNwadEMn8ruCOjOPzGlg9k5QzjEqiXweGsg5eY~IpQO1FuBzK3GSqi2YvEFL5jPfBuXOgUG3w3NwyXrYypjtLvwtyfZb0dnsk5GjD~7u7WvYub-Whyxkh31mZe6zlp9h3pp1iw-gn77b93b-nN~57Oaw__'),
  prawo: plik('media__1', 'c8d1f3ee-da9b-41c8-b14b-7bddc16cac99', 2103440903,
    'GTRxjDK9cEGM87yd85WXleAyNY2~8ok85TmYa7iV6xsQrjh6hztQMOmV95wuqDeS0XXP2rd6fTVcYgPNA5ji59iZeveV-9p7g4sxHJf98VIpoDHMXykhQvjIz8Ic33xKP7opfmsgA~2stNclTCCPOA~9JtQ66IwBAwmHzkbiMogkPKl3qVMTKcVYvnR0gD5ASySA-CIJtOVYeLj0B9lY-~G0AB0hhHx6klrCxxkp1kx5PmevhLKmfap8wT9ej41O3J6IysRcSyEELj8XMTVc5J-g7~ObzBTVpoQ0o8bcxtGW0vKjJU00eocX6dmnqxgz38AR2RVBwVtvadHgzB~Xjw__'),
  'beauty-uroda': plik('media__1', 'f4ba620b-f0df-492b-a42b-d8a378af31f3', 2103440937,
    'f~QPlDNhzIGr7GCyxI8lzsDlibk~sQzI6VHmpBLvR~nsnAi3pLJKd6YpK3L2aqoq9ntA1QLIbV2I5Nue-15XGP5AhnRmzJxFvZ5BVPUCRjoqvuradd-Z5Lw0YHHc8xPgmPWlTl6bFB14~MxjFFhgd68MXS4poyC-8y9-S6Yhb9UFXOQI7AhKK5tVBahx5091IhrbO8JKFeK8FbMZZAaDHEAoKKtYJwfaSh2DqHhzdc9HV-grKw9UqXpQr0lBdakssrwSpXWgR8i27QETvoCWxbD~BVdlVLl1e0WpQPufskd4C91noM-lCLfr5Kr272wggwRd708vZ065rgXk7ORe3A__'),
  edukacja: plik('media__4', 'ca87d996-2a41-4bb5-b988-abdad6714bae', 2103440987,
    'lRD21887IxGIzDDrMS7Y6TqR4SpgYcDdqakLzgd0t~9AuD~mfO4NgtfnRQbaZD0n4c~~Z07NzOMkf9p~oLlsl256EpmcW4iis6~FNa7JeXwpysReR9DD3RtF6nMYIpXCV0yLwC43st95orXMxBFi9YjOZtZagwhdLNSAdR~MGGAzmGzJpsjErxSpYyjQr8sZ9k6rJnlWCSXWTz81eCiONcqPB9l~~lpaIeoZfQZbT2X9QUgT-reIoXkhoG7IEiqf6K8utLJjIoGMVFzQfsVu6z25xZWgU~Ju~8SoSPXwl~gvENIczW-M7n~S26g0goTiYAyl9FawM94s1l~Ukw1mYA__'),
  transport: plik('media__7', '73d367cd-7a5e-4407-a380-0affbd81b636', 2103440990,
    'vsLNrtDhgH9vzq7STT4pgDqsNqxz9TKpYNZdGHkn5jlb2JgXv7ws5xMXEHVh7j1mD908EUmunndY-Gi3KoTbJEJQQFEOa8bVaBMAs76Bjb1-38LcP4DGSViujZi6Cp66WP5uPTQaXZsCb2d4tG2MNm6C5OvoVHfh8mnLa7q0lBVc0Lsk-2SfC30~fItXP59xir2sXkWCqMZWtsnVdGeZBagVNb5D-ZzX51OpxG-W~5sSl6wFGHlkc5MSEsTPepFpvJOO4Y4jk2VXP4~NbkaovebxhkCOLyG9OOA9obq2GA7v92SZ05TA585L25vmJ7VQUcx9RPLo840m8aC4cWvgEQ__'),
  gastronomia: plik('media__8', 'f00716e6-6d04-4531-a27f-dab8d40f0944', 2103440994,
    'DRkmymzYU0Q2LlRtbd-dWhN-DmIH7dSJC45vGXAsPQaSna4u42u~WD1yhWXIAa6LCOtMlCPtCVDAXkSUiFVnlMx3M5me2xy9ZMR1U2~MimN2LQaQcJew8kfv9qxjnGuGEZ58ZPvKTvB9~N0PZFIip3UvQwSc9LIQlnb7-1X2yWl~CwwX0Yrn4EOvTwzz0atVnpffkOvvwLjl56RjsmvRoI2hH7Q7MfGR8F7zaoW2t0T7hfOZtyqKlDqE4dil4LVxZ8EVOENyIItzGBz93ZzedEL-flFZDmYxw3BfqPNKefu~Vhz1zG7xP3qUsApRUZB3rWAUphDpuDMhhl4rx4mfxA__'),
  stomatologia: plik('media__2', 'b79d9242-a6e5-4277-8f25-16299653c026', 2103440998,
    'HJXyDXGpeU2Cw6BRf7Y8roKHbx3smJp2uD6Bid81zw6BJjIV2uzSvOxkR0BdvO~bMUE1YF1vI7vmclin9iMCW-D-2o4Xacd-6SK9MHSUF9MgdgwL6RhhUo5eWKfsolYPAG76iivc74nQESjOKlMtAh8~RCBwSwsqnd61PYJO2EiRkB06GTwQF06m7DJEjQ~pvTPC2LQzb8SgMN1McjmIbeDUwD0DFYTnODn7Vs5tK7W91SLLYc5ou8l1xjMK60prD-mRPmi5zXTNL7I9mGaMbRo35mVtjzE7j5VMhGrxGJwPxVG4eBHiftS6hVXQUnfd9DDdgn0Sjjt6wGxIwiXBeg__'),
  farmacja: plik('media__8', '484e7190-1aad-44da-b62c-35edb45586cd', 2103441001,
    'jpsUAbx4rBtM4kiCt7UmD~rZ5yVJK~X0zUk86cjhmKCrJFd6zJ6JpJkYUem229cEIO6Zjp7MFD4VJ2r9GJS9ESEhoJDTRFR6-ml2RI1K4agD0QV~G-PLTyND2WXDl6yFXxNl-e0Ek-VRehYiYoS0F6hZrYVvuYQ4c5~2eyh5JagWzAzA17i-KhMdYTleztJQYCE0p-JhTaX3-Yd5GuzLbMdc246o3A7pr9croEh6i2VHLZ7orUEKQ7PfEtkVMhkLdHUURun79KtlxoCW0GGbZ1SGfxvdX82K12FMFg2IEF8QI4zw5yEt2Hb2L7I9ueSlW93pjxmDYXaH-gYualbTlg__'),
};

export const ZAWODY = {
  chirurg: plik('media__7', '0e76a5dd-b964-426c-9238-afadf8eedb71', 2103448913,
    'zcUgVV3imqJvefW9ODb-B6jlvMrQEBJ-lVPg2Zun8Dyt6D28PjrhlrulTbYnHNFFOiJgWQniU3KMlzJcOcGXQrrEsfJj3exYSJwI-0WgrtEdwJLd357hzDhLqZsB-UEChVIzogDNcR73qeUDK7STAVJdo~dgRawMipf2A-HHh9rcqjTOAKQEhqvXz8XBdWTUuU2MC3DezkjJYkiif4uT8dnALbNxkcGvqptQG7Kp3DiekJ0wIeBdFDzFavRJeLzcakUXIuojJSPvlCAjlXElcGTEnF5eLMtyTBp0fvfRfif-FB9m3QwGEbVth2d2AuHlMhNYSAUvs2pRj4N~64LMgQ__'),
  weterynarz: plik('media__6', '0ce577a1-4be9-42f7-9099-e756763b1708', 2103448928,
    'hrm-g-S-O5mfEi4uHzzOk-At7RWHn1FaYmFMrGja72WaNJCtQhR1BK27UiZClh2xZjUAGvSOCNqsEJlk5-6-ZFSPTnKes4QScug-tk4tf2u-h~lXwEQLrP1qSn5zQhcCfCiyEhJBqSlCT0xDL~Sn4NB5QduI46iEhKYOE-Mw41ITdbH0wy0FJISeDdupjTwwxrD1T~yOgcCo6s9iuwXQxNBPoh1yQxfx4tqsfRevqc7NugMMN7zv1Qhq-gp49pnOeVUJDxVr5cTvcDIdJLiOUElzhQLffFrUTxHo6OtqYcGq5T7cXo1eJO0IQmfdlcvrC1wqHOxQwKnYdPKL0pZSpQ__'),
  spawacz: plik('media__2', 'eaac5eeb-abec-46fd-93cc-2b0edcfd80cc', 2103448932,
    'JHGCpV42DvenD65AXLfC~gwVoQQ2yVq3AeHrSVCjz~rjct0eVYwAl~C8CL1quK3dhpkiqVbN~aRgE5R7jig7dSJhk4f8n34vep5JMPB~3IUeXG~PGqFgy46KSx-SB3zNhuadQs96Gy6Fy~rvI8WyV~FG6sUbAjN7~G4M6bWl9kABBOC53nO5T7mOsc0vUYgNPUOi6vR-n4ty3DSpEoh40~BmNF-UroUJMcedMM2o1gDwvFXcVnE~e5Sdx0BszR~H6O9iYTOOQ53eDgThw2Gh-wbsvRwP6BQfJMjtyZfvMJQNVBlegxiU~qDyVoMZ8FT~pN4UuUnZ3rNnFCFprnZoaQ__'),
  dekarz: plik('media__6', '0d269fc5-5eab-4581-86c8-8f046657dab8', 2103448936,
    'XgXoTOPJ~xWS-PBEmGeeM-wEW2ypAhdYZYacPQpytwb6ueWtMiATiG~YKqlfCwH9qtF3fW8xvUqfqF-EdqFUNX70-XRli-AHZQXT4VaBCqJ0-35Jcc334RQWp4HW0C8rMqWdLJhPO68HVOj3DVSft1vsRZM3Zitjzx2f2UGzFScpI6cs~aB7OxITyPhQwTrk6zi7zKPnwwn5PRshxzpodUI-Y1SYtL8WJKP1p8ZnCh6pEEm-fQ-A4NBf1ZDv9jRNLOPXyGnBHMhUu2e0~27BrUz0J6pA5AE4roNiuFELyiw6SlNChhTQF7qCMC0ZJUjXUIcwqyNX0NedJAOAtMeIZA__'),
  tatuazysta: plik('media__10', 'fa0b2093-1f55-4a1e-875b-3e0a1980d80b', 2103448942,
    'kb-yEWvo8YywWjdS5~tdq2ydWQvbhUwwETB1iEcea3LUof1nIItrp7BjDeyhOgqptI~A~G-vNs8V~qxmPQGgVVsp3GXL0EZEfsqkR7m9MvTv43avkmGfwZQh~-GfLH17x7mgkjnZQ2bXiR8rqN-7jXXIzaGxTIoB7XNzyvzkzwmjeFyOxzSAC2Q3wY9DBvrqkdG58vWeqjl~QZXTbBi5u0-bzn6nkHyGWRCkduAVOBMHcS2ZJjHD~1Ofgvj9BvV8hTU4Rml2TxQhBpxsYOYJg438yrrLn4O6dB~ktetT~KMhKkRaSFdgb4krXo4zErWrQQKFB72j7YVvPZ9HxEeZPQ__'),
  pilot: plik('media__6', '87686f61-ef01-41be-98bf-4a19f1cae277', 2103448946,
    'ITt-tZ3p3hZCbfeTHA~E5HkcuMp2xXAn0rsgYrYUcheZtm3EjWdNKUuBdGJ4MnS6oDyIayCRBOQKMAUiAeod8Eslop9JCl-Ucka32DSdbkM3iBU2svrk38ejR61FruesN6Zo~pOHe~6f9wtBZM-RuEb-nnatLgA0NGVIhK4mUq-MWXU6GCkWcyBYN3uI4CpEjy2uV-JfmK3bgRGKQX~kakzQUEvultDe~pUJWCvBhb80WIuCaoPHdGH~d4g8gwtOEKraBEIivWICi7GYxZYZ-UzUg-XawzTNMdZj5dbcts74afRbaTz2uHUxDf7zJSUGuRoLq10TiZJ9vfwmABwG1A__'),
  barista: plik('media__6', 'f5d6b4a7-319d-49c1-b020-9e594960fbdf', 2103448950,
    'McIGKKRavLqfMUjhZPDGHBX554DwVbXW--ENZPT5sAPiYmHiQ63x4R6tMFmuJcAnQWQOL3bj6Bc89wxSxNM0brhP6ddNgoqfW8RIuAzIufI-UEDnlY4PVAYvG~~I0synINpybcEYTa9qcrr8AukqxiAalqD01JP3JoNtO0PycVVPH7EzWGK0KWAghzi59-DxL224ZXYk5HIf~QACU7s6N0Zf0MIpbgbixBdPJxCTMP15DNWQKjiqS73CW5AexLDERaLtdPIYzsYV0Oxd~c28fmAXcSEnAOI9EUv2AejdVo7fEnxWH0LyvXKLK5-g-xKv~SqYmrfQwwTF82vkKZDFFQ__'),
  geodeta: plik('media__9', '834f5145-9e76-42fe-80c6-d53ad6c38a64', 2103448954,
    'j9E4xu0MbbsnAF6rS07Y0iipodtJ8RG~eIUGe6Hn4i-BtczxnkfOEMGyxxaUdoHpXZj-mHzhABpHf7joqjRkzxzjJhDqlbTZ83I4vorTD4OWXFWjLNWs7hVv~hYlgwjyd3Vl3olZF02wwqmgobDJMlwAkVQC0cnkQ9pFspkiHWwktiLcojkCCRIMFuh6B9uy7wmbBAS~~xfbIKsq0NuzmjzZf72p8suQZ4jBW2rs-qfDVy1F8YXSgWJfRDTKu6j6oEo7a4yEu0ANMzgKk7Psi5Covs7mpKtNIhZQW57~1yBKopiJfFoad4o-QRdsvh41DzbRBCF1g2c5JYqqZJUfnQ__'),
};
