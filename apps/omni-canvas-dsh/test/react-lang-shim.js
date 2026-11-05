// The parts of @openuidev/react-lang that src/client/omni-ui.js touches at import time. The
// real renderer is exercised in the browser; these tests only need the renderer map.
export const createLibrary = spec => spec
export const defineComponent = spec => spec
export const reactive = schema => schema
export const Renderer = () => null
export const useStateField = (name, value) => ({ name, value, setValue: () => {} })
export const useTriggerAction = () => () => {}
