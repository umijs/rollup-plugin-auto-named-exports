import esquery from 'esquery';
import { get as _get } from 'lodash';
import MagicString from 'magic-string';
import { makeLegalIdentifier, createFilter } from 'rollup-pluginutils';
import { createHash } from 'crypto';
import { extname } from 'path';

// it's should be verify that treating it as commonjs plugin coverted flag.
const COMMONJS_CONVERTED_FLAG = '__moduleExports';

type nodeValueType = 'ObjectExpression' | 'Identifier' | 'CallExpression';

export interface IOptions {
  sourceMap?: boolean;
  extensions?: string[];
  include?: string;
  exclude?: string;
}

export interface IExportedItem {
  local: {
    name: string;
  };
  exported: {
    name: string;
  };
}

export interface IProperties {
  key: {
    name: string;
  };
}

export interface INodeValue {
  type: nodeValueType;
  properties?: IProperties[];
}

/**
 * avoid var conflict
 * @param file module id
 * @param name var name
 * @param maxLength max hash length
 */
function hashString(file: string, name: string, maxLength: number = 5): string {
  return createHash('md5')
    .update(`${file}__${name}`)
    .digest('base64')
    .substr(0, maxLength);
}

/**
 * find named export declare source
 * @param ast
 * @param name
 */
function findDeclareSourceNode(ast: any, name: string): INodeValue | undefined {
  const [found] = esquery(ast, `VariableDeclarator[id.name=${name}]`);
  const init = _get(found, 'init');
  if (!init) {
    return undefined;
  }
  if (init.type === 'Identifier') {
    return findDeclareSourceNode(ast, init.name);
  } else if (init.type === 'ObjectExpression') {
    return init;
  } else if (init.type === 'CallExpression') {
    // TODO
  }
}

/**
 * find exported node by var name
 * like: export { packages as __moduleExports };
 * @param ast
 * @param name
 */
function findExportedNode(ast: any, name: string): IExportedItem | undefined {
  const [exported] = esquery(ast, `ExportSpecifier[exported.name="${name}"]`);
  return exported;
}

export default function namedExport(options: IOptions = { sourceMap: false }) {
  const extensions = options.extensions || ['.js'];
  const filter = createFilter(options.include, options.exclude);

  return {
    name: 'autoNamedExport',
    transform(code: string, id: string) {
      if (!filter(id) || extensions.indexOf(extname(id)) === -1) {
        return null;
      }

      // if(id.indexOf("node_modules/_classnames@2.2.6@classnames/index.js") !== -1) {
      //   console.log(code);
      // }

      const { sourceMap } = options;
      const magicString = new MagicString(code);
      const ast = this.parse(code);
      // find converted flag by commonjs plugin, we auto named export base on that.
      const commonjsExported = findExportedNode(ast, COMMONJS_CONVERTED_FLAG);
      const moduleName = _get(commonjsExported, 'local.name');
      const nodeValue = findDeclareSourceNode(ast, moduleName);
      const properties = _get(nodeValue, 'properties');
      if (properties) {
        properties.forEach((item: IProperties) => {
          const { name } = item.key;
          // avoid duplicate export
          if (!findExportedNode(ast, name)) {
            const hashedName = makeLegalIdentifier(`${name}_${hashString(id, name)}`);
            magicString.append(
              `\nvar ${hashedName} = ${name} \nexport { ${hashedName} as ${name} }\n`,
            );
          }
        });

        return {
          code: magicString.toString(),
          map: sourceMap ? magicString.generateMap() : null,
        };
      }

      return null;
    },
  };
}
