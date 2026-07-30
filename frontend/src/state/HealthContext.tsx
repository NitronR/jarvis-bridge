import { createContext, useContext, useState, type ReactNode } from "react";
import { HealthDot } from "../components/HealthDot";

const HealthContext = createContext<boolean | null>(null);

// Owns the health-poll state so a health flip only re-renders whatever leaf
// component calls useHealthOk() — not every consumer up the tree, which is
// what happens when the boolean is threaded in as a prop.
export function HealthProvider({ children }: { children: ReactNode }) {
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  return (
    <HealthContext.Provider value={healthOk}>
      <HealthDot onUpdate={setHealthOk} />
      {children}
    </HealthContext.Provider>
  );
}

export function useHealthOk(): boolean | null {
  return useContext(HealthContext);
}
