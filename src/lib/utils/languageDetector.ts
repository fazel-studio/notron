import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';

export async function getLanguageExtension(filename: string): Promise<Extension> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  // Note: @codemirror/lang-angular is intentionally not in this switch
  // because it's meant for inline Angular templates inside .ts files.

  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': case 'ts': case 'mts': case 'cts': case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({ jsx: true, typescript: ext.includes('ts') });
    }
    case 'py': case 'pyw': case 'pyi': {
      const { python } = await import('@codemirror/lang-python');
      return python();
    }
    case 'rs': {
      const { rust } = await import('@codemirror/lang-rust');
      return rust();
    }
    case 'c': case 'h': case 'cpp': case 'cc': case 'cxx': case 'hpp': case 'hh': case 'hxx': case 'ino': {
      const { cpp } = await import('@codemirror/lang-cpp');
      return cpp();
    }
    case 'java': {
      const { java } = await import('@codemirror/lang-java');
      return java();
    }
    case 'html': case 'htm': case 'xhtml': {
      const { html } = await import('@codemirror/lang-html');
      return html();
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css');
      return css();
    }
    case 'less': {
      const { less } = await import('@codemirror/lang-less');
      return less();
    }
    case 'sass': case 'scss': {
      const { sass } = await import('@codemirror/lang-sass');
      return sass({ indented: ext === 'sass' });
    }
    case 'json': case 'jsonc': case 'json5': {
      const { json } = await import('@codemirror/lang-json');
      return json();
    }
    case 'xml': case 'xsd': case 'xsl': case 'svg': case 'plist': {
      const { xml } = await import('@codemirror/lang-xml');
      return xml();
    }
    case 'md': case 'markdown': case 'mdx': {
      const { markdown } = await import('@codemirror/lang-markdown');
      return markdown();
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql');
      return sql();
    }
    case 'php': case 'phtml': {
      const { php } = await import('@codemirror/lang-php');
      return php();
    }
    case 'go': {
      const { go } = await import('@codemirror/lang-go');
      return go();
    }
    case 'yaml': case 'yml': {
      const { yaml } = await import('@codemirror/lang-yaml');
      return yaml();
    }
    case 'vue': {
      const { vue } = await import('@codemirror/lang-vue');
      return vue();
    }
    case 'liquid': {
      const { liquid } = await import('@codemirror/lang-liquid');
      return liquid();
    }
    case 'jinja': case 'jinja2': case 'j2': {
      const { jinja } = await import('@codemirror/lang-jinja');
      return jinja();
    }
    case 'wat': case 'wast': {
      const { wast } = await import('@codemirror/lang-wast');
      return wast();
    }
    case 'svelte': {
      const { svelte } = await import('codemirror-lang-svelte');
      return svelte();
    }
    case 'grammar': {
      const { lezer } = await import('@codemirror/lang-lezer');
      return lezer();
    }

    // --- Legacy Modes ---
    case 'sh': case 'bash': case 'zsh': case 'fish': {
      const { shell } = await import('@codemirror/legacy-modes/mode/shell');
      return StreamLanguage.define(shell);
    }
    case 'rb': case 'erb': case 'rake': case 'gemspec': {
      const { ruby } = await import('@codemirror/legacy-modes/mode/ruby');
      return StreamLanguage.define(ruby);
    }
    case 'lua': {
      const { lua } = await import('@codemirror/legacy-modes/mode/lua');
      return StreamLanguage.define(lua);
    }
    case 'pl': case 'pm': {
      const { perl } = await import('@codemirror/legacy-modes/mode/perl');
      return StreamLanguage.define(perl);
    }
    case 'ps1': case 'psm1': case 'psd1': {
      const { powerShell } = await import('@codemirror/legacy-modes/mode/powershell');
      return StreamLanguage.define(powerShell);
    }
    case 'dockerfile': {
      const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile');
      return StreamLanguage.define(dockerFile);
    }
    case 'toml': {
      const { toml } = await import('@codemirror/legacy-modes/mode/toml');
      return StreamLanguage.define(toml);
    }
    case 'ini': case 'cfg': case 'properties': case 'env': {
      const { properties } = await import('@codemirror/legacy-modes/mode/properties');
      return StreamLanguage.define(properties);
    }
    case 'diff': case 'patch': {
      const { diff } = await import('@codemirror/legacy-modes/mode/diff');
      return StreamLanguage.define(diff);
    }
    case 'cmake': {
      const { cmake } = await import('@codemirror/legacy-modes/mode/cmake');
      return StreamLanguage.define(cmake);
    }
    case 'cs': {
      const { csharp } = await import('@codemirror/legacy-modes/mode/clike');
      return StreamLanguage.define(csharp);
    }
    case 'kt': case 'kts': {
      const { kotlin } = await import('@codemirror/legacy-modes/mode/clike');
      return StreamLanguage.define(kotlin);
    }
    case 'scala': case 'sc': {
      const { scala } = await import('@codemirror/legacy-modes/mode/clike');
      return StreamLanguage.define(scala);
    }
    case 'm': case 'mm': {
      const { objectiveC } = await import('@codemirror/legacy-modes/mode/clike');
      return StreamLanguage.define(objectiveC);
    }
    case 'dart': {
      const { dart } = await import('@codemirror/legacy-modes/mode/clike');
      return StreamLanguage.define(dart);
    }
    case 'swift': {
      const { swift } = await import('@codemirror/legacy-modes/mode/swift');
      return StreamLanguage.define(swift);
    }
    case 'r': {
      const { r } = await import('@codemirror/legacy-modes/mode/r');
      return StreamLanguage.define(r);
    }
    case 'pas': case 'pp': {
      const { pascal } = await import('@codemirror/legacy-modes/mode/pascal');
      return StreamLanguage.define(pascal);
    }
    case 'hs': {
      const { haskell } = await import('@codemirror/legacy-modes/mode/haskell');
      return StreamLanguage.define(haskell);
    }
    case 'clj': case 'cljs': case 'cljc': case 'edn': {
      const { clojure } = await import('@codemirror/legacy-modes/mode/clojure');
      return StreamLanguage.define(clojure);
    }
    case 'erl': case 'hrl': {
      const { erlang } = await import('@codemirror/legacy-modes/mode/erlang');
      return StreamLanguage.define(erlang);
    }
    case 'groovy': case 'gradle': {
      const { groovy } = await import('@codemirror/legacy-modes/mode/groovy');
      return StreamLanguage.define(groovy);
    }
    case 'fs': case 'fsi': case 'fsx': {
      const { fSharp } = await import('@codemirror/legacy-modes/mode/mllike');
      return StreamLanguage.define(fSharp);
    }
    case 'ml': case 'mli': {
      const { oCaml } = await import('@codemirror/legacy-modes/mode/mllike');
      return StreamLanguage.define(oCaml);
    }
    case 'nginx': case 'conf': {
      const { nginx } = await import('@codemirror/legacy-modes/mode/nginx');
      return StreamLanguage.define(nginx);
    }
    case 'proto': {
      const { protobuf } = await import('@codemirror/legacy-modes/mode/protobuf');
      return StreamLanguage.define(protobuf);
    }
    case 'pug': case 'jade': {
      const { pug } = await import('@codemirror/legacy-modes/mode/pug');
      return StreamLanguage.define(pug);
    }
    case 'styl': case 'stylus': {
      const { stylus } = await import('@codemirror/legacy-modes/mode/stylus');
      return StreamLanguage.define(stylus);
    }
    case 'tex': case 'sty': case 'cls': {
      const { stex } = await import('@codemirror/legacy-modes/mode/stex');
      return StreamLanguage.define(stex);
    }
    default:
      return [];
  }
}
