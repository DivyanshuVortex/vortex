import ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

export type ChunkKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum";

export interface Chunk {
  id: string;

  file: string;
  language: string;

  name: string;
  symbolPath: string;

  kind: ChunkKind;

  parent?: string;

  isExported: boolean;
  isAsync: boolean;

  signature?: string;

  dependencies: string[];

  startLine: number;
  endLine: number;

  hash: string;

  content: string;
}

export function chunkFile(
  filePath: string,
): Chunk[] {
  const source = fs.readFileSync(
    filePath,
    "utf-8",
  );

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const chunks: Chunk[] = [];

  function getLanguage(file: string): string {
    return path.extname(file).replace(".", "");
  }

  function getLine(pos: number): number {
    return (
      sourceFile.getLineAndCharacterOfPosition(pos)
        .line + 1
    );
  }

  function getHash(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    return crypto
      .createHash("sha1")
      .update(normalized)
      .digest("hex");
  }

  function isExported(
    node: ts.Node,
  ): boolean {
    if (!ts.canHaveModifiers(node)) {
      return false;
    }

    const modifiers =
      ts.getModifiers(node);

    return !!modifiers?.some(
      (m) =>
        m.kind ===
        ts.SyntaxKind.ExportKeyword,
    );
  }

  function isAsyncFunction(
    node:
      | ts.FunctionDeclaration
      | ts.MethodDeclaration
      | ts.ArrowFunction
      | ts.FunctionExpression,
  ): boolean {
    if (!ts.canHaveModifiers(node)) {
      return false;
    }

    const modifiers =
      ts.getModifiers(node);

    return !!modifiers?.some(
      (m) =>
        m.kind ===
        ts.SyntaxKind.AsyncKeyword,
    );
  }

  function getChunkKind(
    node: ts.Node,
  ): ChunkKind {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      return "function";
    }

    if (ts.isClassDeclaration(node)) {
      return "class";
    }

    if (ts.isMethodDeclaration(node)) {
      return "method";
    }

    if (
      ts.isInterfaceDeclaration(node)
    ) {
      return "interface";
    }

    if (
      ts.isTypeAliasDeclaration(node)
    ) {
      return "type";
    }

    if (ts.isEnumDeclaration(node)) {
      return "enum";
    }

    throw new Error(
      `Unsupported chunk kind: ${
        ts.SyntaxKind[node.kind]
      }`,
    );
  }

  function buildSignature(
    node:
      | ts.FunctionDeclaration
      | ts.MethodDeclaration
      | ts.ArrowFunction
      | ts.FunctionExpression,
  ): string {
    const text =
      node.getText(sourceFile);

    const braceIndex =
      text.indexOf("{");

    if (braceIndex === -1) {
      return text.trim();
    }

    return text
      .slice(0, braceIndex)
      .trim();
  }

  const COMMON_BUILTINS = new Set([
    "console", "console.log", "console.error", "console.warn", "console.info",
    "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "JSON",
    "Promise", "Error", "Map", "Set", "RegExp"
  ]);

  /**
   * Collect only meaningful deps
   */
  function extractDependencies(
    node: ts.Node,
  ): string[] {
    const deps = new Set<string>();

    function collect(n: ts.Node) {
      /**
       * fn()
       * obj.method()
       */
      if (ts.isCallExpression(n)) {
        const text = n.expression.getText(sourceFile);
        if (!COMMON_BUILTINS.has(text)) {
          deps.add(text);
        }
      }

      /**
       * import x from "pkg"
       */
      if (
        ts.isImportDeclaration(n)
      ) {
        deps.add(
          n.moduleSpecifier
            .getText(sourceFile)
            .replace(/['"]/g, ""),
        );
      }

      ts.forEachChild(n, collect);
    }

    collect(node);

    return [...deps];
  }

  function createChunk(params: {
    /**
     * Semantic node
     */
    node: ts.Node;

    /**
     * Actual source content node
     *
     * Used for:
     * const foo = () => {}
     */
    contentNode?: ts.Node;

    name: string;

    parent?: string;
  }) {
    const {
      node,
      contentNode,
      name,
      parent,
    } = params;

    const actualContentNode =
      contentNode ?? node;

    const content =
      actualContentNode.getText(
        sourceFile,
      );

    const startLine = getLine(
      actualContentNode.getStart(
        sourceFile,
      ),
    );

    const endLine = getLine(
      actualContentNode.getEnd(),
    );

    const kind =
      getChunkKind(node);

    const symbolPath = parent
      ? `${parent}.${name}`
      : name;

    const hash =
      getHash(content);

    let signature:
      | string
      | undefined;

    let isAsync = false;

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      signature =
        buildSignature(node);

      isAsync =
        isAsyncFunction(node);
    }

    const chunk: Chunk = {
      id: `${symbolPath}:${hash.slice(
        0,
        12,
      )}`,

      file: filePath,

      language:
        getLanguage(filePath),

      name,

      symbolPath,

      kind,

      parent,

      isExported:
        isExported(node),

      isAsync,

      signature,

      dependencies:
        extractDependencies(node),

      startLine,

      endLine,

      hash,

      content,
    };

    chunks.push(chunk);

    console.log({
      symbol:
        chunk.symbolPath,
      kind: chunk.kind,
      exported:
        chunk.isExported,
      lines: `${startLine}-${endLine}`,
    });
  }

  function visit(
    node: ts.Node,
    parentSymbol?: string,
  ) {
    /**
     * function foo() {}
     */
    if (
      ts.isFunctionDeclaration(
        node,
      ) &&
      node.name
    ) {
      createChunk({
        node,
        name: node.name.getText(
          sourceFile,
        ),
      });
    }

    /**
     * class Foo {}
     */
    if (
      ts.isClassDeclaration(
        node,
      ) &&
      node.name
    ) {
      const className =
        node.name.getText(
          sourceFile,
        );

      createChunk({
        node,
        name: className,
      });

      /**
       * Visit class members manually
       */
      for (const member of node.members) {
        visit(member, className);
      }

      /**
       * Prevent duplicate traversal
       */
      return;
    }

    /**
     * class Foo {
     *   login() {}
     * }
     */
    if (
      ts.isMethodDeclaration(
        node,
      ) &&
      node.name
    ) {
      createChunk({
        node,
        name: node.name.getText(
          sourceFile,
        ),
        parent: parentSymbol,
      });
    }

    /**
     * const foo = () => {}
     * const foo = function() {}
     */
    if (
      ts.isVariableDeclaration(
        node,
      )
    ) {
      const initializer =
        node.initializer;

      if (
        initializer &&
        (
          ts.isArrowFunction(
            initializer,
          ) ||
          ts.isFunctionExpression(
            initializer,
          )
        )
      ) {
        createChunk({
          /**
           * Semantic kind
           */
          node: initializer,

          /**
           * Full declaration content
           */
          contentNode: node,

          name: node.name.getText(
            sourceFile,
          ),

          parent: parentSymbol,
        });
      }
    }

    /**
     * interface Foo {}
     */
    if (
      ts.isInterfaceDeclaration(
        node,
      )
    ) {
      createChunk({
        node,
        name: node.name.getText(
          sourceFile,
        ),
      });
    }

    /**
     * type Foo = {}
     */
    if (
      ts.isTypeAliasDeclaration(
        node,
      )
    ) {
      createChunk({
        node,
        name: node.name.getText(
          sourceFile,
        ),
      });
    }

    /**
     * enum Foo {}
     */
    if (
      ts.isEnumDeclaration(
        node,
      )
    ) {
      createChunk({
        node,
        name: node.name.getText(
          sourceFile,
        ),
      });
    }

    ts.forEachChild(
      node,
      (child) =>
        visit(
          child,
          parentSymbol,
        ),
    );
  }

  visit(sourceFile);

  return chunks;
}