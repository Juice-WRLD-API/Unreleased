import { createContext, useContext } from 'react'

// Code/Section/Endpoint/MethodPath render differently on desktop (hover,
// borders) vs mobile (active states, touch-sized targets) - every Tab in
// content.tsx pulls its copy from context instead of importing one directly,
// so the same tab content renders correctly on either platform.
export interface DocsPrimitives {
  Code: (props: { children: string }) => JSX.Element
  Section: (props: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => JSX.Element
  Endpoint: (props: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH'; path: string; description: string }) => JSX.Element
  MethodPath: (props: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH'; path: string; className?: string }) => JSX.Element
}

const DocsPrimitivesContext = createContext<DocsPrimitives | null>(null)

export function DocsPrimitivesProvider({ value, children }: { value: DocsPrimitives; children: React.ReactNode }) {
  return <DocsPrimitivesContext.Provider value={value}>{children}</DocsPrimitivesContext.Provider>
}

export function usePrimitives(): DocsPrimitives {
  const ctx = useContext(DocsPrimitivesContext)
  if (!ctx) throw new Error('usePrimitives() called outside a DocsPrimitivesProvider')
  return ctx
}
