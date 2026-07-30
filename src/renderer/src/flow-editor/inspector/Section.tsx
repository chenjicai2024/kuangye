import type React from 'react'

export function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ color: '#f3f4f6', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </section>
  )
}
