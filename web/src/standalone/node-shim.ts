// Empty stand-ins for Node built-ins that shared server modules import but never call in the browser build.
export default {};
export const createRequire = () => () => {
  throw new Error('Node built-ins are not available in the browser build');
};
export const fileURLToPath = (u: string) => u;
