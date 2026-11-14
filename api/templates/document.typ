// Gabarit des documents Firmo (DOC-5, DOC-8). Un seul fichier, trois modèles : classic, modern,
// clean. Les données arrivent préparées par api/src/render/model.ts (montants déjà formatés,
// libellés dans la langue de l'artisan) : ce gabarit ne calcule rien.

#let data = json(bytes(sys.inputs.data))
#let style = data.style
#let c = data.colors
#let L = data.labels
#let brand = rgb(c.brand)
#let on-brand = rgb(c.onBrand)
#let accent = rgb(c.accent)
#let tint = rgb(c.tint)
#let ink = rgb(c.ink)
#let muted = rgb(c.muted)
#let hair = rgb(c.line)

#let sans = ("Inter",)
#let serif = ("Source Serif 4", "Inter")
#let title-font = if style == "classic" { serif } else { sans }
// Nom très long : plus petit, pour rester sur deux lignes.
#let name-scale = if data.issuer.name.len() > 42 { 0.8 } else { 1 }

#set document(title: data.doc.kind + " " + data.doc.number, author: data.issuer.name)
#set text(font: sans, size: 9.2pt, fill: ink, lang: data.lang)
#set par(leading: 0.55em)
#set page(
  paper: "a4",
  margin: (top: 16mm, bottom: 22mm, x: 16mm),
  // Modèle moderne : bandeau de couleur pleine largeur, première page seulement.
  background: if style == "modern" {
    context if counter(page).get().first() == 1 {
      place(top + left, rect(width: 100%, height: 42mm, fill: brand))
    }
  },
  footer: context [
    #set text(size: 7.2pt, fill: muted)
    #line(length: 100%, stroke: 0.4pt + hair)
    #v(-1mm)
    #grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      [#data.footer.legal],
      [#data.footer.brand · #counter(page).display("1 / 1", both: true)],
    )
  ],
)

// ---------------------------------------------------------------- éléments

#let logo-box(height) = if data.issuer.logo {
  image("/assets/logo.png", height: height, fit: "contain")
}

#let issuer-lines(fill) = {
  set text(fill: fill)
  for l in data.issuer.lines { [#l \ ] }
}

#let doc-meta(fill: ink, label-fill: muted) = {
  set text(fill: fill)
  grid(
    columns: (auto, auto),
    column-gutter: 4mm,
    row-gutter: 1.6mm,
    align: (right, left),
    ..data.doc.meta.filter(m => not (style == "clean" and m.key == "number")).map(m => (text(fill: label-fill, size: 8pt, m.label), text(weight: "semibold", m.value))).flatten(),
  )
}

// Tampon de statut (accepté, payé…) : dans le flux, sous l'en-tête, jamais par-dessus.
#let stamp() = if data.doc.stamp != none {
  v(3mm)
  align(right, rotate(-4deg, reflow: true, box(
    stroke: 1.4pt + rgb(data.doc.stampColor),
    inset: (x: 3mm, y: 1.6mm),
    radius: 2pt,
    text(fill: rgb(data.doc.stampColor), weight: "bold", size: 10.5pt, tracking: 1pt, data.doc.stamp),
  )))
  v(-6mm)
}

#let draft-mark() = if data.doc.draft {
  place(center + horizon, rotate(-30deg, text(size: 72pt, weight: "bold", fill: rgb(0, 0, 0, 14), L.draft)))
}

// ---------------------------------------------------------------- en-tête

#let header-classic() = {
  block(
    width: 100%,
    stroke: (bottom: 1.2pt + brand),
    inset: (bottom: 4mm),
    grid(
      columns: (1fr, auto),
      column-gutter: 8mm,
      [
        #grid(
          columns: if data.issuer.logo { (auto, 1fr) } else { (1fr,) },
          column-gutter: 4mm,
          ..(if data.issuer.logo { (logo-box(18mm),) } else { () }),
          [
            #text(font: serif, size: 15pt * name-scale, weight: "bold", data.issuer.name) \
            #if data.issuer.trade != none { text(fill: muted, size: 8.5pt, style: "italic", data.issuer.trade) } \
            #v(1mm)
            #text(size: 8.4pt, issuer-lines(muted))
          ],
        )
      ],
      align(right)[
        #text(font: serif, size: 22pt, weight: "bold", fill: accent, tracking: 0.5pt, upper(data.doc.kind)) \
        #v(2mm)
        #doc-meta()
      ],
    ),
  )
}

#let header-modern() = {
  // Le bandeau (42 mm) est dessiné en arrière-plan de la page ; ici, son contenu (30 mm utiles).
  block(
    width: 100%,
    height: 24mm,
    grid(
      columns: (1fr, auto),
      column-gutter: 8mm,
      align: horizon,
      [
        #grid(
          columns: if data.issuer.logo { (auto, 1fr) } else { (1fr,) },
          column-gutter: 4mm,
          align: horizon,
          ..(if data.issuer.logo {
            (box(fill: white, inset: 2mm, radius: 3pt, logo-box(14mm)),)
          } else { () }),
          [
            #text(fill: on-brand, size: 16pt * name-scale, weight: "bold", data.issuer.name) \
            #if data.issuer.trade != none { text(fill: on-brand.transparentize(20%), size: 8.5pt, data.issuer.trade) }
          ],
        )
      ],
      align(right)[
        #text(fill: on-brand, size: 24pt, weight: "bold", upper(data.doc.kind))
      ],
    ),
  )
  v(12mm)
  grid(
    columns: (1fr, auto),
    column-gutter: 8mm,
    text(size: 8.4pt, issuer-lines(muted)),
    doc-meta(),
  )
  v(2mm)
}

#let header-clean() = {
  grid(
    columns: (1fr, auto),
    column-gutter: 8mm,
    [
      #if data.issuer.logo { logo-box(13mm); v(3mm) }
      #text(size: 12.5pt * name-scale, weight: "semibold", data.issuer.name) \
      #if data.issuer.trade != none { text(fill: muted, size: 8.5pt, data.issuer.trade) } \
      #v(1.5mm)
      #text(size: 8.2pt, issuer-lines(muted))
    ],
    align(right)[
      #text(size: 9pt, fill: accent, weight: "semibold", tracking: 2pt, upper(data.doc.kind)) \
      #v(1mm)
      #text(size: 20pt, weight: "regular", data.doc.number) \
      #v(2mm)
      #doc-meta()
    ],
  )
  v(4mm)
  line(length: 100%, stroke: 0.4pt + hair)
}

// ---------------------------------------------------------------- corps

#let client-block() = {
  let left = if data.client != none {
    block(
      width: 100%,
      inset: if style == "clean" { 0mm } else { 3.5mm },
      radius: 3pt,
      fill: if style == "modern" { tint } else { none },
      stroke: if style == "classic" { 0.6pt + hair } else { none },
      [
        #text(size: 7.6pt, fill: muted, weight: "semibold", tracking: 0.8pt, upper(L.client)) \
        #v(0.6mm)
        #text(size: 10.5pt, weight: "semibold", data.client.name) \
        #set text(size: 8.4pt, fill: muted)
        #for l in data.client.lines { [#l \ ] }
      ],
    )
  }
  let right = if data.doc.title != none {
    block(
      width: 100%,
      inset: if style == "clean" { 0mm } else { 3.5mm },
      [
        #text(size: 7.6pt, fill: muted, weight: "semibold", tracking: 0.8pt, upper(L.subject)) \
        #v(0.6mm)
        #text(size: 10pt, data.doc.title)
      ],
    )
  }
  if left != none or right != none {
    grid(columns: (1fr, 1fr), column-gutter: 6mm, left, right)
    v(5mm)
  }
}

#let receipt-block() = if data.receipt != none {
  block(
    width: 100%,
    inset: 5mm,
    radius: 4pt,
    fill: tint,
    [
      #text(size: 11pt, data.receipt.text) \
      #v(2mm)
      #text(size: 20pt, weight: "bold", fill: accent, data.receipt.amount)
      #if data.receipt.method != none [  #v(1mm) #text(fill: muted, data.receipt.method) ]
    ],
  )
  v(5mm)
}

#let lines-table() = if data.receipt == none {
  let head-fill = if style == "modern" { brand } else if style == "classic" { tint } else { none }
  let head-text = if style == "modern" { on-brand } else { ink }
  let row-stroke = if style == "classic" { 0.5pt + hair } else { none }
  if data.currencyNote != none {
    align(right, text(size: 7.6pt, fill: muted, data.currencyNote))
    v(-2mm)
  }
  table(
    columns: (7mm, 1fr, 15mm, 13mm, 25mm, 27mm),
    align: (center + top, left + top, right + top, left + top, right + top, right + top),
    inset: (x: 2mm, y: 2.4mm),
    stroke: (x, y) => if style == "classic" { row-stroke } else if y == 0 { none } else { (bottom: 0.4pt + hair) },
    fill: (x, y) => if y == 0 { head-fill } else if style == "modern" and calc.even(y) { tint.transparentize(40%) } else { none },
    table.header(
      ..L.columns.map(h => text(fill: head-text, size: 7.8pt, weight: "semibold", h)),
    ),
    ..data.rows.map(r => (
      text(fill: muted, r.n),
      [#r.label#if r.detail != none [ \ #text(size: 7.6pt, fill: muted, r.detail)]],
      r.qty,
      text(fill: muted, r.unit),
      r.price,
      text(weight: "medium", r.total),
    )).flatten(),
  )
}

#let totals-block() = {
  let rows = data.totals.map(t => (
    text(fill: if t.strong { ink } else { muted }, weight: if t.strong { "semibold" } else { "regular" }, t.label),
    text(weight: if t.strong { "bold" } else { "medium" }, size: if t.strong { 11pt } else { 9.2pt }, fill: if t.strong and style != "classic" { accent } else { ink }, t.value),
  )).flatten()
  align(right, block(
    width: 78mm,
    inset: if style == "clean" { 0mm } else { 3.5mm },
    radius: 3pt,
    fill: if style == "modern" { tint } else { none },
    stroke: if style == "classic" { 0.8pt + accent } else { none },
    grid(columns: (1fr, auto), row-gutter: 2.2mm, column-gutter: 4mm, align: (left, right), ..rows),
  ))
}

#let closing() = {
  v(4mm)
  if data.words != none {
    text(size: 8.6pt, style: "italic", data.words)
    v(4mm)
  }
  let blocks = ()
  if data.paymentMethods != none {
    blocks.push(block(width: 100%, [
      #text(size: 7.6pt, fill: muted, weight: "semibold", tracking: 0.8pt, upper(L.paymentMethods)) \
      #v(0.6mm)
      #text(size: 8.6pt, data.paymentMethods)
    ]))
  }
  if data.notes != none {
    blocks.push(block(width: 100%, [
      #text(size: 7.6pt, fill: muted, weight: "semibold", tracking: 0.8pt, upper(L.notes)) \
      #v(0.6mm)
      #text(size: 8.6pt, data.notes)
    ]))
  }
  if data.footerNote != none {
    blocks.push(text(size: 8pt, fill: muted, data.footerNote))
  }
  grid(
    columns: if data.qr { (1fr, 26mm) } else { (1fr,) },
    column-gutter: 6mm,
    stack(spacing: 4mm, ..blocks),
    ..(if data.qr {
      (align(center)[
        #image("/assets/qr.svg", width: 22mm)
        #text(size: 6.6pt, fill: muted, data.qrCaption)
      ],)
    } else { () }),
  )
}

// ---------------------------------------------------------------- page

#draft-mark()
#if style == "classic" { header-classic() } else if style == "modern" { header-modern() } else { header-clean() }
#stamp()
#v(6mm)
#client-block()
#receipt-block()
#lines-table()
#v(3mm)
#totals-block()
#closing()
