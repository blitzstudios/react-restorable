"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = restorableBabelPlugin;
var _path = _interopRequireDefault(require("path"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Makes component state restorable across an eviction, and tags scrollable JSX call sites with a
 * stable id; the runtime decides at render time what is worth keeping.
 *
 * Each function that calls a state hook gets one restoration frame, and each call takes its initial
 * value through it and reports what it rendered:
 *
 *   const _restore = useRestorationFrame("src/screens/example#0");
 *   const [round, setRound] = _restore.state(0, useState(_restore.initial(0, leg)));
 *
 * `initial` hands back `leg` itself except on a restoring mount, so the call allocates nothing extra.
 *
 * Run it after React Compiler, which recognizes `useState` by name and has to see the plain hook.
 * Opt a call or element out with `// @no-restore` on its line or the line above.
 */

const DEFAULT_RUNTIME_MODULE = '@sleeperhq/react-restorable';
const FRAME_HOOK = 'useRestorationFrame';
const DEFAULT_OPT_OUT = '@no-restore';
const SCROLLABLE_PROP = '__restoreId';
const DEFAULT_SCROLLABLE_COMPONENTS = ['ScrollView', 'FlatList', 'FlashList', 'SectionList', 'VirtualizedList'];
const DEFAULT_SCROLLABLE_QUALIFIERS = ['Animated', 'ReAnimated'];

/** `useRef` and `useEffect` are deliberately absent: restoring a ref desyncs render-derived values, and skipping an effect swallows its side effects. */
const REACT_HOOKS = new Set(['useState']);
function isQualifiedPath(parts, scrollables) {
  if (parts.length === 0 || parts.length > 2) return false;
  if (parts.length === 2 && !scrollables.qualifiers.has(parts[0])) return false;
  return scrollables.components.has(parts[parts.length - 1]);
}
function isScrollableJsxName(nameNode, scrollables) {
  const parts = [];
  let node = nameNode;
  while (node && node.type === 'JSXMemberExpression') {
    parts.unshift(node.property.name);
    node = node.object;
  }
  if (!node || node.type !== 'JSXIdentifier' || node.name !== scrollables.root) return false;
  return isQualifiedPath(parts, scrollables);
}
function isScrollableValue(node, scrollables) {
  let current = node;
  while (current && (current.type === 'TSAsExpression' || current.type === 'TSTypeAssertion' || current.type === 'TSNonNullExpression')) {
    current = current.expression;
  }
  const parts = [];
  while (current && current.type === 'MemberExpression' && !current.computed && current.property.type === 'Identifier') {
    parts.unshift(current.property.name);
    current = current.object;
  }
  if (!current || current.type !== 'Identifier' || current.name !== scrollables.root) return false;
  return isQualifiedPath(parts, scrollables);
}
function isScrollableElement(nodePath, scrollables) {
  const nameNode = nodePath.node.name;
  if (nameNode.type === 'JSXMemberExpression') return isScrollableJsxName(nameNode, scrollables);
  if (nameNode.type !== 'JSXIdentifier') return false;

  // An alias imported from another module is out of reach here and has to carry an explicit `__restoreId`.
  const binding = nodePath.scope.getBinding(nameNode.name);
  if (!binding || binding.path.type !== 'VariableDeclarator') return false;
  const init = binding.path.node.init;
  return Boolean(init) && isScrollableValue(init, scrollables);
}
function hasHandWrittenRestoration(programNode, runtimeModule) {
  return programNode.body.some(node => node.type === 'ImportDeclaration' && node.source.value === runtimeModule);
}
function toUnix(filename) {
  return filename.split(_path.default.sep).join('/');
}
function isExcluded(filename, include, exclude) {
  if (!filename) return true;
  const unix = toUnix(filename);
  if (unix.includes('/node_modules/')) return true;
  if (/\.(test|spec)\.[jt]sx?$/.test(unix)) return true;
  if (unix.includes('__mocks__') || unix.includes('__tests__')) return true;
  if (exclude.some(part => unix.includes(part))) return true;
  return include !== undefined && !include.some(part => unix.includes(part));
}

/** The path from Babel's root with the extension dropped, so ids survive a move of the repo but not of the file. */
function moduleIdOf(filename, root) {
  const relative = toUnix(_path.default.relative(root, filename));
  const id = relative.startsWith('../') ? toUnix(filename) : relative;
  return id.replace(/\.[jt]sx?$/, '');
}
function hasOptOut(nodePath, optOut) {
  const node = nodePath.node;
  const comments = [...(node.leadingComments || []), ...(node.trailingComments || [])];
  if (comments.some(comment => comment.value.includes(optOut))) return true;

  // A trailing comment on the same line attaches to the enclosing statement, not the call.
  const statement = nodePath.getStatementParent();
  if (!statement) return false;
  const statementComments = [...(statement.node.leadingComments || []), ...(statement.node.trailingComments || [])];
  return statementComments.some(comment => comment.value.includes(optOut) && comment.loc && node.loc && comment.loc.start.line <= node.loc.start.line + 1);
}
function isStateHook(nodePath, helperHooks) {
  const callee = nodePath.node.callee;
  let name;
  if (callee.type === 'Identifier') {
    name = callee.name;
  } else if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.object.name === 'React' && callee.property.type === 'Identifier') {
    name = callee.property.name;
  } else {
    return false;
  }
  const helperSource = Object.prototype.hasOwnProperty.call(helperHooks, name) ? helperHooks[name] : undefined;
  if (!REACT_HOOKS.has(name) && helperSource === undefined) return false;
  if (callee.type !== 'Identifier') return true;
  const binding = nodePath.scope.getBinding(name);
  if (!binding || binding.kind !== 'module') return false;
  const source = binding.path.parent.source?.value;
  if (REACT_HOOKS.has(name) && source === 'react') return true;
  return helperSource !== undefined && typeof source === 'string' && source.includes(helperSource);
}
function restorableBabelPlugin({
  types: t
}, options = {}) {
  const runtimeModule = options.runtimeModule ?? DEFAULT_RUNTIME_MODULE;
  const optOut = options.optOut ?? DEFAULT_OPT_OUT;
  const helperHooks = options.helperHooks ?? {};
  const exclude = options.exclude ?? [];
  const scrollables = options.scrollables && {
    root: options.scrollables.root,
    components: new Set(options.scrollables.components ?? DEFAULT_SCROLLABLE_COMPONENTS),
    qualifiers: new Set(options.scrollables.qualifiers ?? DEFAULT_SCROLLABLE_QUALIFIERS)
  };
  const frameCall = (local, method, args) => t.callExpression(t.memberExpression(t.identifier(local), t.identifier(method)), args);
  const fileState = state => state.restorable;
  return {
    name: 'react-restorable',
    visitor: {
      Program: {
        enter(programPath, state) {
          const filename = state.file.opts.filename;
          const root = state.file.opts.root ?? state.cwd ?? process.cwd();
          const excluded = isExcluded(filename, options.include, exclude) || hasHandWrittenRestoration(programPath.node, runtimeModule);
          state.restorable = {
            frameCounter: 0,
            scrollableCounter: 0,
            frames: new Map(),
            rewritten: new WeakSet(),
            excluded,
            moduleId: filename ? moduleIdOf(filename, root) : ''
          };
        },
        exit(programPath, state) {
          const {
            frames
          } = fileState(state);
          if (frames.size === 0) return;

          // Inserted after traversal, since giving an arrow a block body mid-traversal would move the calls being visited.
          for (const frame of frames.values()) {
            const {
              id,
              local
            } = frame;
            const fnPath = frame.fnPath;
            fnPath.ensureBlock();
            const init = t.callExpression(t.identifier(FRAME_HOOK), [t.stringLiteral(id)]);
            const body = fnPath.get('body');
            body.unshiftContainer('body', t.variableDeclaration('const', [t.variableDeclarator(t.identifier(local), init)]));
          }
          const specifier = t.importSpecifier(t.identifier(FRAME_HOOK), t.identifier(FRAME_HOOK));
          programPath.unshiftContainer('body', t.importDeclaration([specifier], t.stringLiteral(runtimeModule)));
        }
      },
      JSXOpeningElement(nodePath, state) {
        const context = fileState(state);
        if (context.excluded || !scrollables) return;
        if (!isScrollableElement(nodePath, scrollables)) return;
        if (hasOptOut(nodePath, optOut)) return;
        if (nodePath.node.attributes.some(attr => attr.type === 'JSXAttribute' && attr.name.name === SCROLLABLE_PROP)) return;
        const id = `${context.moduleId}@${context.scrollableCounter}`;
        context.scrollableCounter += 1;
        nodePath.node.attributes.push(t.jsxAttribute(t.jsxIdentifier(SCROLLABLE_PROP), t.stringLiteral(id)));
      },
      CallExpression(nodePath, state) {
        const context = fileState(state);
        if (context.excluded) return;
        if (context.rewritten.has(nodePath.node)) return;
        if (!isStateHook(nodePath, helperHooks)) return;
        if (hasOptOut(nodePath, optOut)) return;
        const args = nodePath.node.arguments;
        // Spread would put the initial value somewhere the read cannot find it.
        if (args.some(arg => arg.type === 'SpreadElement')) return;

        // A hook called outside any function breaks the rules of hooks already; leave it for the lint to catch.
        const fnPath = nodePath.getFunctionParent();
        if (!fnPath) return;
        let frame = context.frames.get(fnPath.node);
        if (!frame) {
          frame = {
            fnPath,
            id: `${context.moduleId}#${context.frameCounter}`,
            local: fnPath.scope.generateUidIdentifier('restore').name,
            slots: 0
          };
          context.frameCounter += 1;
          context.frames.set(fnPath.node, frame);
        }
        const slot = t.numericLiteral(frame.slots);
        frame.slots += 1;
        const call = nodePath.node;
        const initialValue = args[0] ?? t.identifier('undefined');
        call.arguments = [frameCall(frame.local, 'initial', [slot, initialValue]), ...args.slice(1)];
        context.rewritten.add(call);
        nodePath.replaceWith(frameCall(frame.local, 'state', [t.cloneNode(slot), call]));
      }
    }
  };
}
//# sourceMappingURL=index.js.map