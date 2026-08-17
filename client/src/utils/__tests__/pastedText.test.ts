import { detectPastedLanguage, shouldPasteAsFile } from '../pastedText';

describe('pastedText', () => {
  it('treats large prose documents as text', () => {
    const result = detectPastedLanguage(`
WikipediaThe Free Encyclopedia
Search Wikipedia
Search
Donate
Create account
Log in
Contents hide
(Top)
Uncrewed landings

Crewed landings
Scientific background
Political background
Early Soviet uncrewed lunar missions (1958-1965)
Early U.S. uncrewed lunar missions (1958-1965)
Soviet uncrewed soft landings (1966-1976)
U.S. uncrewed soft landings (1966-1968)
Transition from direct ascent landings to lunar orbit operations
    `);

    expect(result).toEqual({ language: 'Text', ext: 'txt', isCode: false });
  });

  it('does not classify prose with code words as JavaScript or SQL', () => {
    const result = detectPastedLanguage(`
This document describes how to select a function name and class structure for a
proposal. The interface should be simple, and teams may import examples from
past documents, but this is all explanatory prose rather than source code.
    `);

    expect(result).toEqual({ language: 'Text', ext: 'txt', isCode: false });
  });

  it('detects TypeScript snippets as code', () => {
    const result = detectPastedLanguage(`
interface User {
  id: string;
  name: string;
}

const formatUser = (user: User): string => {
  return user.name;
};
    `);

    expect(result).toEqual({ language: 'TypeScript', ext: 'ts', isCode: true });
  });

  it('detects Python snippets as code', () => {
    const result = detectPastedLanguage(`
from pathlib import Path

def read_file(path: Path) -> str:
    return path.read_text()
    `);

    expect(result).toEqual({ language: 'Python', ext: 'py', isCode: true });
  });

  it('detects JSON as code', () => {
    const result = detectPastedLanguage('{"items":[{"id":"one","active":true}]}');

    expect(result).toEqual({ language: 'JSON', ext: 'json', isCode: true });
  });

  it('keeps markdown as a text document', () => {
    const result = detectPastedLanguage(`
# Project notes

- First item
- Second item

[Docs](https://example.com)
    `);

    expect(result).toEqual({ language: 'Markdown', ext: 'md', isCode: false });
  });

  it('only turns large pasted content into an attachment', () => {
    expect(shouldPasteAsFile('short paste')).toBe(false);
    expect(shouldPasteAsFile(Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\n'))).toBe(
      true,
    );
  });
});
