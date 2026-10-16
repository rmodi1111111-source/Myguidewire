import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setApiUser, type Producer, type User } from './api';

export interface Question {
  code: string;
  section: string;
  text: string;
  type: 'yesno' | 'select';
  options?: string[];
  required: boolean;
}

export interface RefData {
  products: Record<string, { code: string; name: string; abbreviation: string; riskSteps: { key: string; label: string }[] }>;
  states: Record<string, string>;
  industries: { naics: string; description: string }[];
  entityTypes: string[];
  sources: string[];
  cyber: { questions: Question[]; limits: number[]; retentions: number[]; seLimits: number[] };
  property: { constructionClasses: Record<string, { name: string }>; occupancies: Record<string, { factor: number; hazard: string }>; aopDeductibles: number[]; windHailDeductibles: number[] };
  gl: { classes: { code: string; description: string; basis: string; premOpsRate: number; productsRate: number; hazard: string }[]; limitOptions: Record<string, { occurrence: number; aggregate: number }>; deductibles: number[] };
  sanctionsList: { name: string; program: string; country: string }[];
}

interface Ctx {
  ref: RefData;
  user: User;
  users: User[];
  producers: Producer[];
  switchUser: (id: number) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Ctx, 'switchUser'> | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    Promise.all([api<RefData>('/reference'), api<User>('/me'), api<User[]>('/users'), api<Producer[]>('/producers')])
      .then(([ref, user, users, producers]) => setState({ ref, user, users, producers }))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  if (error) return <div className="boot-error">Unable to reach the server: {error}</div>;
  if (!state) return <div className="boot-loading">Loading PreBind Center...</div>;
  const switchUser = (id: number) => {
    setApiUser(id);
    setState({ ...state, user: state.users.find((u) => u.id === id)! });
  };
  return <AppContext.Provider value={{ ...state, switchUser }}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside provider');
  return c;
}
