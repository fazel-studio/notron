import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';
import { go } from '@codemirror/lang-go';

export function getLanguageExtension(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: ext.includes('ts') });
    case 'py':
    case 'pyw':
      return python();
    case 'rs':
      return rust();
    case 'cpp':
    case 'c':
    case 'h':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return cpp();
    case 'java':
      return java();
    case 'html':
    case 'htm':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'md':
    case 'markdown':
      return markdown();
    case 'sql':
      return sql();
    case 'php':
      return php();
    case 'go':
      return go();
    default:
      return []; // plain text fallback
  }
}
