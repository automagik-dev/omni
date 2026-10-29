// Just enough of React for importing src/client/omni-ui.js in Node tests. The browser gets
// the shell's real React (scripts/build-client.mjs keeps it external); these tests only need
// to call the component functions and inspect what they build.
export const Fragment = Symbol('Fragment')
export const createElement = (type, props, ...children) => ({
  type,
  props: { ...props, children: children.length === 0 ? props?.children : children.length === 1 ? children[0] : children },
})
export class Component { constructor(props) { this.props = props } }
export const createContext = value => ({ Provider: 'Provider', _currentValue: value })
export const useContext = context => context?._currentValue
export const useCallback = fn => fn
export const useEffect = () => {}
export const useMemo = make => make()
export const useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}]
