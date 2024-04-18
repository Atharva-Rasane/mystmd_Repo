import type { Caption, Container } from 'myst-spec';
import type { Code } from 'myst-spec-ext';
import { nanoid } from 'nanoid';
import yaml from 'js-yaml';
import type { DirectiveData, DirectiveSpec, GenericNode } from 'myst-common';
import { fileError, fileWarn, normalizeLabel, RuleId } from 'myst-common';
import type { VFile } from 'vfile';
import { select } from 'unist-util-select';

function parseEmphasizeLines(emphasizeLinesString?: string | undefined): number[] | undefined {
  if (!emphasizeLinesString) return undefined;
  const emphasizeLines = emphasizeLinesString
    ?.split(',')
    .map((val) => Number(val.trim()))
    .filter((val) => Number.isInteger(val));
  return emphasizeLines;
}

/** This function parses both sphinx and RST code-block options */
export function getCodeBlockOptions(
  data: DirectiveData,
  vfile: VFile,
  defaultFilename?: string,
): Pick<Code, 'emphasizeLines' | 'showLineNumbers' | 'startingLineNumber' | 'filename'> {
  const { options, node } = data;
  if (options?.['lineno-start'] != null && options?.['number-lines'] != null) {
    fileWarn(vfile, 'Cannot use both "lineno-start" and "number-lines"', {
      node: select('mystDirectiveOption[name="number-lines"]', node) ?? node,
      source: 'code-block:options',
      ruleId: RuleId.directiveOptionsCorrect,
    });
  }
  const emphasizeLines = parseEmphasizeLines(options?.['emphasize-lines'] as string | undefined);
  const numberLines = options?.['number-lines'] as number | undefined;
  // Only include this in mdast if it is `true`
  const showLineNumbers =
    options?.linenos || options?.['lineno-start'] || options?.['lineno-match'] || numberLines
      ? true
      : undefined;
  let startingLineNumber: number | undefined =
    numberLines != null && numberLines > 1 ? numberLines : (options?.['lineno-start'] as number);
  if (options?.['lineno-match']) {
    startingLineNumber = 'match' as any;
  } else if (startingLineNumber == null || startingLineNumber <= 1) {
    startingLineNumber = undefined;
  }
  let filename = options?.['filename'] as string | undefined;
  if (filename?.toLowerCase() === 'false') {
    filename = undefined;
  } else if (!filename && defaultFilename) {
    filename = defaultFilename;
  }
  return {
    emphasizeLines,
    showLineNumbers,
    startingLineNumber,
    filename,
  };
}

export const CODE_DIRECTIVE_OPTIONS: DirectiveSpec['options'] = {
  caption: {
    type: 'myst',
    doc: 'A parsed caption for the code block.',
  },
  linenos: {
    type: Boolean,
    doc: 'Show line numbers',
  },
  'lineno-start': {
    type: Number,
    doc: 'Start line numbering from a particular value, default is 1. If present, line numbering is activated.',
  },
  'number-lines': {
    type: Number,
    doc: 'Alternative for "lineno-start", turns on line numbering and can be an integer that is the start of the line numbering.',
  },
  'emphasize-lines': {
    type: String,
    doc: 'Emphasize particular lines (comma-separated numbers), e.g. "3,5"',
  },
  filename: {
    type: String,
    doc: 'Show the filename in addition to the rendered code. The `include` directive will use the filename by default, to turn off this default set the filename to `false`.',
  },
  // dedent: {
  //   type: Number,
  //   doc: 'Strip indentation characters from the code block',
  // },
  // force: {
  //   type: Boolean,
  //   doc: 'Ignore minor errors on highlighting',
  // },
};

export function parseTags(input: any, vfile: VFile, node: GenericNode): string[] | undefined {
  if (!input) return undefined;
  if (typeof input === 'string' && input.startsWith('[') && input.endsWith(']')) {
    try {
      return parseTags(yaml.load(input) as string[], vfile, node);
    } catch (error) {
      fileError(vfile, 'Could not load tags for code-cell directive', {
        node: select('mystDirectiveOption[name="tags"]', node) ?? node,
        source: 'code-cell:tags',
        ruleId: RuleId.directiveOptionsCorrect,
      });
      return undefined;
    }
  }
  if (typeof input === 'string') {
    const tags = input
      .split(/[,\s]/)
      .map((t) => t.trim())
      .filter((t) => !!t);
    return tags.length > 0 ? tags : undefined;
  }
  if (!Array.isArray(input)) return undefined;
  // if the options are loaded directly as yaml (or in recursion)
  const tags = input as unknown as string[];
  if (tags && Array.isArray(tags) && tags.every((t) => typeof t === 'string')) {
    if (tags.length > 0) {
      return tags.map((t) => t.trim()).filter((t) => !!t);
    }
  } else if (tags) {
    fileWarn(vfile, 'tags in code-cell directive must be a list of strings', {
      node: select('mystDirectiveOption[name="tags"]', node) ?? node,
      source: 'code-cell:tags',
      ruleId: RuleId.directiveOptionsCorrect,
    });
    return undefined;
  }
}

export const codeDirective: DirectiveSpec = {
  name: 'code',
  doc: 'A code-block environment with a language as the argument, and options for highlighting, showing line numbers, and an optional filename.',
  alias: ['code-block', 'sourcecode'],
  arg: {
    type: String,
    doc: 'Code language, for example `python` or `typescript`',
  },
  options: {
    label: {
      type: String,
      alias: ['name'],
    },
    class: {
      type: String,
      // class_option: list of strings?
    },
    ...CODE_DIRECTIVE_OPTIONS,
  },
  body: {
    type: String,
    doc: 'The raw code to display for the code block.',
  },
  run(data, vfile): GenericNode[] {
    const { label, identifier } = normalizeLabel(data.options?.label as string | undefined) || {};
    const opts = getCodeBlockOptions(data, vfile);
    const code: Code = {
      type: 'code',
      lang: data.arg as string,
      class: data.options?.class as string,
      ...opts,
      value: data.body as string,
    };
    if (!data.options?.caption) {
      code.label = label;
      code.identifier = identifier;
      return [code];
    }
    const caption: Caption = {
      type: 'caption',
      children: [
        {
          type: 'paragraph',
          children: data.options.caption as any[],
        },
      ],
    };
    const container: Container = {
      type: 'container',
      kind: 'code' as any,
      label,
      identifier,
      children: [code as any, caption],
    };
    return [container];
  },
};

export const codeCellDirective: DirectiveSpec = {
  name: 'code-cell',
  doc: 'An executable code cell',
  arg: {
    type: String,
    doc: 'Language for execution and display, for example `python`. It will default to the language of the notebook or containing markdown file.',
  },
  options: {
    label: {
      type: String,
      alias: ['name'],
    },
    tags: {
      type: String,
      alias: ['tag'],
      doc: 'A comma-separated list of tags to add to the cell, for example, `remove-input` or `hide-cell`.',
    },
  },
  body: {
    type: String,
    doc: 'The code to be executed and displayed.',
  },
  run(data, vfile): GenericNode[] {
    const { label, identifier } = normalizeLabel(data.options?.label as string | undefined) || {};
    const code: Code = {
      type: 'code',
      lang: data.arg as string,
      executable: true,
      value: (data.body ?? '') as string,
    };
    const output = {
      type: 'output',
      id: nanoid(),
      data: [],
    };
    const block: GenericNode = {
      type: 'block',
      label,
      identifier,
      children: [code, output],
      data: {
        type: 'notebook-code',
      },
    };

    const tags = parseTags(data.options?.tags, vfile, data.node);
    if (tags) block.data.tags = tags;

    return [block];
  },
};
