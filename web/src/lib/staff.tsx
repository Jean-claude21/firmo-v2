import { createContext, useContext } from "react";

// Membre de l'équipe connecté à la console. Dans un module partagé : une route découpée par le
// build ne doit pas créer sa propre copie du contexte (sinon le rôle paraît vide ailleurs).
export interface StaffMe {
  email: string;
  role: "admin" | "support";
  env: string;
}

export const StaffContext = createContext<StaffMe | null>(null);
export const useStaff = () => useContext(StaffContext);
