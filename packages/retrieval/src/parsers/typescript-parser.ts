import ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { Chunk, ChunkKind } from "../chunker";
import { LanguageParser } from "./parser-registry";

const COMMON_BUILTINS = new Set([
  "console", "console.log", "console.error", "console.warn", "console.info",
  "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "JSON",
  "Promise", "Error", "Map", "Set", "RegExp",
]);

/**
 * TypeScript / JavaScript parser using the TypeScript Compiler API.
 *
 * Handles: .ts, .tsx, .js, .jsx, .mjs, .cjs
 *
 * This is extracted from the original chunker.ts and wrapped
 * in the LanguageParser interface.
 */
export class TypeScriptParser implements LanguageParser {
  readonly name = "TypeScript";
  readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

  parse(filePath: string, source: string): Chunk[] {
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
        sourceFile.getLineAndCharacterOfPosition(pos).line + 1
      );
    }

    function getHash(content: string): string {
      const normalized = content.replace(/\s+/g, " ").trim();
      return crypto
        .createHash("sha1")
        .update(normalized)
        .digest("hex");
    }

    function isExported(node: ts.Node): boolean {
      if (!ts.canHaveModifiers(node)) {
        return false;
      }
      const modifiers = ts.getModifiers(node);
      return !!modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
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
      const modifiers = ts.getModifiers(node);
      return !!modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
      );
    }

    function getChunkKind(node: ts.Node): ChunkKind {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        return "function";
      }
      if (
        ts.isCallExpression(node) ||
        ts.isVariableDeclaration(node)
      ) {
        return "variable";
      }
      if (ts.isClassDeclaration(node)) {
        return "class";
      }
      if (ts.isMethodDeclaration(node)) {
        return "method";
      }
      if (ts.isInterfaceDeclaration(node)) {
        return "interface";
      }
      if (ts.isTypeAliasDeclaration(node)) {
        return "type";
      }
      if (ts.isEnumDeclaration(node)) {
        return "enum";
      }
      throw new Error(
        `Unsupported chunk kind: ${ts.SyntaxKind[node.kind]}`,
      );
    }

    function buildSignature(
      node:
        | ts.FunctionDeclaration
        | ts.MethodDeclaration
        | ts.ArrowFunction
        | ts.FunctionExpression,
    ): string {
      const text = node.getText(sourceFile);
      const braceIndex = text.indexOf("{");
      if (braceIndex === -1) {
        return text.trim();
      }
      return text.slice(0, braceIndex).trim();
    }

    function extractDependencies(node: ts.Node): string[] {
      const deps = new Set<string>();

      function collect(n: ts.Node) {
        if (ts.isCallExpression(n)) {
          const text = n.expression.getText(sourceFile);
          if (!COMMON_BUILTINS.has(text)) {
            deps.add(text);
          }
        }
        if (ts.isImportDeclaration(n)) {
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
      node: ts.Node;
      contentNode?: ts.Node;
      name: string;
      parent?: string;
      parentId?: string;
    }) {
      const { node, contentNode, name, parent, parentId } = params;
      const actualContentNode = contentNode ?? node;

      const content = actualContentNode.getText(sourceFile);
      const startLine = getLine(actualContentNode.getStart(sourceFile));
      const endLine = getLine(actualContentNode.getEnd());
      const kind = getChunkKind(node);
      const symbolPath = parent ? `${parent}.${name}` : name;
      const hash = getHash(content);

      let signature: string | undefined;
      let isAsync = false;

      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      ) {
        signature = buildSignature(node);
        isAsync = isAsyncFunction(node);
      }

      const chunk: Chunk = {
        id: `${symbolPath}:${hash.slice(0, 12)}`,
        file: filePath,
        language: getLanguage(filePath),
        name,
        symbolPath,
        kind,
        parent,
        parentId,
        isExported: isExported(node),
        isAsync,
        signature,
        dependencies: extractDependencies(node),
        startLine,
        endLine,
        hash,
        content,
      };

      chunks.push(chunk);
    }

    function visit(node: ts.Node, parentSymbol?: string, parentChunkId?: string) {
      // Function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        createChunk({
          node,
          name: node.name.getText(sourceFile),
        });
      }

      // Class declarations — create parent + children
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.getText(sourceFile);
        const classHash = getHash(node.getText(sourceFile));
        const classChunkId = `${className}:${classHash.slice(0, 12)}`;

        createChunk({
          node,
          name: className,
        });

        // Visit members with parent reference
        for (const member of node.members) {
          visit(member, className, classChunkId);
        }
        return;
      }

      // Method declarations
      if (ts.isMethodDeclaration(node) && node.name) {
        createChunk({
          node,
          name: node.name.getText(sourceFile),
          parent: parentSymbol,
          parentId: parentChunkId,
        });
      }

      // Variable declarations with function-like initializers
      if (ts.isVariableDeclaration(node)) {
        const initializer = node.initializer;
        let isFunctionLike = false;

        if (initializer) {
          if (
            ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer)
          ) {
            isFunctionLike = true;
          } else if (ts.isCallExpression(initializer)) {
            isFunctionLike = initializer.arguments.some(
              (arg) =>
                ts.isArrowFunction(arg) ||
                ts.isFunctionExpression(arg),
            );
          }
        }

        if (isFunctionLike && initializer) {
          createChunk({
            node: initializer,
            contentNode: node,
            name: node.name.getText(sourceFile),
            parent: parentSymbol,
            parentId: parentChunkId,
          });
        }
      }

      // Interface declarations
      if (ts.isInterfaceDeclaration(node)) {
        createChunk({
          node,
          name: node.name.getText(sourceFile),
        });
      }

      // Type alias declarations
      if (ts.isTypeAliasDeclaration(node)) {
        createChunk({
          node,
          name: node.name.getText(sourceFile),
        });
      }

      // Enum declarations
      if (ts.isEnumDeclaration(node)) {
        createChunk({
          node,
          name: node.name.getText(sourceFile),
        });
      }

      ts.forEachChild(
        node,
        (child) => visit(child, parentSymbol, parentChunkId),
      );
    }

    visit(sourceFile);

    return chunks;
  }
}
