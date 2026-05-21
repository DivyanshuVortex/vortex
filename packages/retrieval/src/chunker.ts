import ts from "typescript";
import * as fs from "fs";

export interface Chunk {
  id: string;
  file: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  content: string;
}

export function chunkFile(filePath: string): Chunk[] {
  const source = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const chunks: Chunk[] = [];
  const lines = source.split("\n");

  function getLine(pos: number) {
    return sourceFile.getLineAndCharacterOfPosition(pos).line;
  }

  function visit(node: ts.Node) {
    const isChunkable =
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node);

    if (isChunkable) {
      const name = (node as any).name?.getText(sourceFile) ?? "anonymous";
      const startLine = getLine(node.getStart());
      const endLine = getLine(node.getEnd());
      const text = lines.slice(startLine, endLine + 1).join("\n");

      console.log({
        name,
        kind: ts.SyntaxKind[node.kind],
        startLine,
        endLine,
      });

      chunks.push({
        id: `${filePath}::${name}::${startLine}`,
        file: filePath,
        name,
        kind: ts.SyntaxKind[node.kind],
        startLine,
        endLine,
        content: text,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return chunks;
}
