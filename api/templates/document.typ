// Gabarit du document Firmo — direction validée de la v1 (docs/design/DESIGN.md, PARITE_V1 P-20 à P-27).
// Le document argumente : entête, filet couleur, destinataire / cadre, objet, détail par sections,
// totaux avec le total général dans le bloc couleur, conditions, bon pour accord.
// Achromatique : la couleur de l'artisan n'occupe que le monogramme, le filet, la barre de l'objet
// et le bloc du total. Aucun calcul ici : montants, dates et libellés arrivent formatés (SQL + API).

#let data = json(bytes(sys.inputs.data))
#let L = data.labels

#let ink = rgb("#181A1B")
#let muted = rgb("#656A6C")
#let hairline = rgb("#D9DDDC")
#let soft = rgb("#F4F5F3")
#let accent = rgb(data.issuer.accent)
#let accent-ink = rgb(data.issuer.accent_ink)

#let present(value) = {
  if value == none { false }
  else if type(value) == str { value.trim() != "" }
  else if type(value) == array { value.len() > 0 }
  else { true }
}

#let unit-mark(color: muted) = text(size: 7pt, fill: color)[#data.currency.symbol]
#let money(value, color: muted) = if data.currency.before [#unit-mark(color: color) #value] else [#value #unit-mark(color: color)]

#let eyebrow(body) = text(font: "JetBrains Mono", size: 6.7pt, weight: 600, fill: muted, tracking: 0.04em, body)
#let label(body) = text(font: "JetBrains Mono", size: 6.5pt, weight: 600, fill: muted, tracking: 0.04em, body)
#let figure-text(body, weight: 400, size: 7.6pt) = text(font: "JetBrains Mono", size: size, weight: weight, body)

#let columns-spec = (1fr, 20mm, 25mm, 28mm)
#let header-row() = grid(
  columns: columns-spec,
  column-gutter: 2mm,
  inset: (y: 2.2mm),
  align: (left, right, right, right),
  stroke: (bottom: 0.7pt + hairline),
  label(L.designation), label(L.qty), label(L.unit_price), label(L.amount),
)

#set page(
  paper: "a4",
  margin: (x: 18mm, top: 16mm, bottom: 15mm),
  foreground: if data.draft {
    align(center + horizon)[
      #rotate(-24deg, text(font: "JetBrains Mono", size: 22pt, weight: 700,
        fill: rgb("#D7DBD8").transparentize(22%))[#L.draft_mark])
    ]
  },
  header: context {
    if counter(page).get().first() > 1 {
      set text(font: "JetBrains Mono", size: 6.8pt, fill: muted)
      grid(columns: (1fr, auto), align: (left, right), [#data.issuer.name], [#data.type · #data.number])
      v(2mm)
      line(length: 100%, stroke: 0.6pt + hairline)
      header-row()
    }
  },
  footer: context {
    set text(size: 6.8pt, fill: muted)
    grid(
      columns: (1fr, auto),
      align: (left, right),
      [#data.issuer.name#for l in data.issuer.legal [ · #l.label #l.value]],
      [#data.number · #counter(page).display("1 / 1", both: true)],
    )
  },
)

#set text(font: "Inter Tight", size: 9pt, fill: ink, lang: data.lang)
#set par(leading: 0.62em)

// ---------------------------------------------------------------- 1. entête
#grid(
  columns: (14mm, 1fr, auto),
  column-gutter: 4mm,
  align: (left, horizon),
  if data.issuer.logo {
    box(width: 14mm, height: 14mm, inset: 0pt)[#image("assets/logo.png", width: 14mm, height: 14mm, fit: "contain")]
  } else {
    box(width: 14mm, height: 14mm, fill: accent, inset: 0pt)[
      #align(center + horizon)[#text(size: 10pt, weight: 700, fill: accent-ink)[#data.issuer.mark]]
    ]
  },
  [
    #if present(data.issuer.name) [#text(size: 14pt, weight: 700)[#data.issuer.name]]
    #let contact = (data.issuer.trade, data.issuer.phone).filter(present)
    #if contact.len() > 0 [
      #v(-1pt)
      #text(size: 8pt, fill: muted)[#contact.join([ · ])]
    ]
    #let more = (data.issuer.email, data.issuer.address).filter(present)
    #if more.len() > 0 [
      #v(0.5pt)
      #text(size: 7pt, fill: muted)[#more.join([ · ])]
    ]
  ],
  align(right)[
    #eyebrow(upper(data.type))
    #v(1.5pt)
    #text(font: "JetBrains Mono", size: 9pt, weight: 700)[#data.number]
    #if present(data.date) [
      #v(1pt)
      #text(size: 7.5pt, fill: muted)[#L.issued_on #data.date]
    ]
  ],
)

// ---------------------------------------------------------------- 2. filet
#v(6mm)
#rect(width: 28mm, height: 1.4pt, fill: accent)
#v(6mm)

// ---------------------------------------------------------------- 3. destinataire / cadre
#let has-client = data.client != none
#let has-frame = data.frame.len() > 0
#if has-client or has-frame {
  grid(
    columns: if has-client and has-frame { (1fr, 1fr) } else { (1fr,) },
    column-gutter: 16mm,
    ..if has-client {
      ([
        #label(L.recipient)
        #v(2.2pt)
        #text(size: 11pt, weight: 600)[#data.client.name]
        #for detail in data.client.details [
          #v(1pt)
          #text(size: 8pt, fill: muted)[#detail]
        ]
      ],)
    } else { () },
    ..if has-frame {
      ([
        #label(L.frame)
        #v(2.2pt)
        #grid(
          columns: (auto, 1fr),
          column-gutter: 3mm,
          row-gutter: 2.2mm,
          ..data.frame.map(f => (text(size: 7.5pt, fill: muted)[#f.label], text(size: 7.5pt, weight: 600)[#f.value])).flatten(),
        )
      ],)
    } else { () },
  )
  v(6mm)
}

// ---------------------------------------------------------------- 4. objet
#if present(data.object) or present(data.summary) {
  block(width: 100%, fill: soft, stroke: (left: 2pt + accent), inset: (x: 4mm, y: 3.2mm))[
    #if present(data.object) [
      #label(L.object)
      #v(2pt)
      #text(size: 12.5pt, weight: 700)[#data.object]
    ]
    #if present(data.summary) [
      #v(2pt)
      #text(size: 8pt, fill: muted)[#data.summary]
    ]
  ]
  v(6mm)
}

// ---------------------------------------------------------------- 5. détail
#header-row()
#for section in data.sections {
  if section.title != none {
    v(3.5mm)
    grid(columns: (1fr, auto), align: (left, right), text(size: 8pt, weight: 700)[#section.title], eyebrow(L.section))
    v(1.2mm)
  }
  for line in section.lines {
    grid(
      columns: columns-spec,
      column-gutter: 2mm,
      inset: (y: 2.5mm),
      align: (left, right, right, right),
      stroke: (bottom: 0.45pt + hairline),
      [
        #text(size: 8.5pt, weight: 500)[#line.label]
        #if present(line.description) [
          #v(0.8pt)
          #text(size: 7.2pt, fill: muted)[#line.description]
        ]
      ],
      if present(line.qty) { text(size: 7.8pt)[#line.qty] } else { [] },
      if present(line.unit_price) { figure-text(line.unit_price, size: 7.4pt) } else { [] },
      if present(line.amount) { figure-text(line.amount, weight: 600, size: 7.8pt) } else { [] },
    )
  }
  if section.subtotal != none {
    grid(
      columns: (1fr, auto),
      inset: (top: 1.8mm),
      align: (left, right),
      label(section.subtotal_label),
      figure-text(money(section.subtotal), weight: 600, size: 7.8pt),
    )
  }
}

// ---------------------------------------------------------------- 6. conditions et totaux
#v(5mm)
#grid(
  columns: (1fr, 72mm),
  column-gutter: 10mm,
  [
    #for block-item in data.notes [
      #label(block-item.title)
      #v(2mm)
      #for item in block-item.items {
        grid(columns: (3mm, 1fr), [#text(fill: accent)[•]], text(size: 7.7pt, fill: muted)[#item])
        v(1.2mm)
      }
      #v(2.5mm)
    ]
  ],
  [
    #if data.totals.before.len() > 0 {
      grid(
        columns: (1fr, auto),
        row-gutter: 2.2mm,
        align: (left, right),
        ..data.totals.before.map(t => (text(size: 8pt, fill: muted)[#t.label], figure-text(money(t.value), size: 7.8pt))).flatten(),
      )
      v(3mm)
    }
    #block(width: 100%, fill: accent, inset: (x: 4mm, y: 3.5mm))[
      #grid(
        columns: (1fr, auto),
        align: (left + horizon, right + horizon),
        text(size: 8pt, weight: 600, fill: accent-ink)[#data.totals.label],
        text(font: "JetBrains Mono", size: 13pt, weight: 700, fill: accent-ink)[#money(data.totals.value, color: accent-ink)],
      )
    ]
    #if data.totals.after.len() > 0 {
      v(2.5mm)
      grid(
        columns: (1fr, auto),
        row-gutter: 1.8mm,
        align: (left, right),
        ..data.totals.after.map(t => (
          text(size: 7.7pt, fill: if t.strong { ink } else { muted }, weight: if t.strong { 600 } else { 400 })[#t.label],
          figure-text(money(t.value), weight: if t.strong { 600 } else { 400 }, size: 7.6pt),
        )).flatten(),
      )
    }
  ],
)

#if present(data.words) [
  #v(3mm)
  #text(size: 7.2pt, fill: muted)[#data.words]
]

// ---------------------------------------------------------------- 7. pied
#v(1fr)
#block(breakable: false)[
#line(length: 100%, stroke: 0.6pt + hairline)
#v(3mm)
#grid(
  columns: if data.qr { (1fr, 1fr, 30mm) } else { (1fr, 1fr) },
  column-gutter: 8mm,
  [
    #label(L.signature)
    #v(2pt)
    #text(size: 7pt, fill: muted)[#L.signature_hint]
  ],
  align(right)[
    #label(L.issuer)
    #v(2pt)
    #text(size: 7pt, fill: muted)[#data.issuer.name]
    #for l in data.issuer.legal [
      #v(1pt)
      #text(size: 6.5pt, fill: muted)[#l.label #l.value]
    ]
    #if present(data.issuer.footer_note) [
      #v(1pt)
      #text(size: 6.5pt, fill: muted)[#data.issuer.footer_note]
    ]
  ],
  ..if data.qr {
    (align(right)[
      #label(L.qr)
      #v(2pt)
      #image("assets/qr.svg", width: 11mm)
    ],)
  } else { () },
)
]
