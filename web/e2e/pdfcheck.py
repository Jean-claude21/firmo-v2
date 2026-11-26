"""Inspection des fichiers rendus pour le parcours de bout en bout.

  python pdfcheck.py text  <fichier.pdf>          texte du PDF (toutes pages)
  python pdfcheck.py color <fichier.png> <#RRGGBB> [tolérance]   nombre de pixels proches de la couleur
  python pdfcheck.py images <fichier.pdf>         nombre d'images incluses dans le PDF
"""
import sys

cmd = sys.argv[1]
path = sys.argv[2]
if cmd == "text":
    import fitz
    doc = fitz.open(path)
    sys.stdout.reconfigure(encoding="utf-8")
    print("\n".join(page.get_text() for page in doc))
elif cmd == "images":
    import fitz
    doc = fitz.open(path)
    print(sum(len(page.get_images(full=True)) for page in doc))
elif cmd == "color":
    from PIL import Image
    hexa = sys.argv[3].lstrip("#")
    tol = int(sys.argv[4]) if len(sys.argv) > 4 else 24
    target = tuple(int(hexa[i:i + 2], 16) for i in (0, 2, 4))
    img = Image.open(path).convert("RGB")
    count = 0
    for px in (img.get_flattened_data() if hasattr(img, "get_flattened_data") else img.getdata()):
        if all(abs(px[i] - target[i]) <= tol for i in range(3)):
            count += 1
    print(count)
