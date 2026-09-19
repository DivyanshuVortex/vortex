import * as path from "path";
import crypto from "crypto";
import { Chunk, ChunkKind } from "../chunker";
import { LanguageParser } from "./parser-registry";

/**
 * Mapping of tree-sitter node types to ChunkKind for each language.
 * Used to extract semantically meaningful chunks from the AST.
 */
interface LanguageConfig {
  language: string;
  extensions: string[];
  /** tree-sitter grammar module name (e.g., "tree-sitter-python") */
  grammarModule: string;
  /** Node types that represent top-level declarations */
  topLevelTypes: string[];
  /** Node types that represent methods inside classes */
  methodTypes: string[];
  /** Node types that represent classes/structs/traits */
  classTypes: string[];
  /** Node types that represent imports */
  importTypes: string[];
  /** How to get the name from a node */
  getNodeName: (node: any) => string | null;
  /** Map a node type to a ChunkKind */
  mapKind: (nodeType: string) => ChunkKind;
}

// ─────────────────────────────────────────────
// Per-language configurations
// ─────────────────────────────────────────────

const PYTHON_CONFIG: LanguageConfig = {
  language: "python",
  extensions: [".py", ".pyw"],
  grammarModule: "tree-sitter-python",
  topLevelTypes: ["function_definition", "class_definition", "decorated_definition"],
  methodTypes: ["function_definition"],
  classTypes: ["class_definition"],
  importTypes: ["import_statement", "import_from_statement"],
  getNodeName: (node: any) => {
    // For decorated_definition, dig into the definition inside
    if (node.type === "decorated_definition") {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === "function_definition" || child.type === "class_definition") {
          return getNameChild(child);
        }
      }
      return null;
    }
    return getNameChild(node);
  },
  mapKind: (t: string) => {
    if (t === "function_definition" || t === "decorated_definition") return "function";
    if (t === "class_definition") return "class";
    return "variable";
  },
};

const GO_CONFIG: LanguageConfig = {
  language: "go",
  extensions: [".go"],
  grammarModule: "tree-sitter-go",
  topLevelTypes: ["function_declaration", "method_declaration", "type_declaration"],
  methodTypes: ["method_declaration"],
  classTypes: ["type_declaration"],
  importTypes: ["import_declaration"],
  getNodeName: (node: any) => getNameChild(node),
  mapKind: (t: string) => {
    if (t === "function_declaration") return "function";
    if (t === "method_declaration") return "method";
    if (t === "type_declaration") return "type";
    return "variable";
  },
};

const RUST_CONFIG: LanguageConfig = {
  language: "rust",
  extensions: [".rs"],
  grammarModule: "tree-sitter-rust",
  topLevelTypes: ["function_item", "struct_item", "enum_item", "impl_item", "trait_item", "type_item", "const_item", "static_item"],
  methodTypes: ["function_item"],
  classTypes: ["struct_item", "enum_item", "impl_item", "trait_item"],
  importTypes: ["use_declaration"],
  getNodeName: (node: any) => {
    // impl blocks: get the type name
    if (node.type === "impl_item") {
      const typeNode = node.childForFieldName("type");
      return typeNode ? typeNode.text : null;
    }
    return getNameChild(node);
  },
  mapKind: (t: string) => {
    if (t === "function_item") return "function";
    if (t === "struct_item") return "class";
    if (t === "enum_item") return "enum";
    if (t === "impl_item") return "class";
    if (t === "trait_item") return "interface";
    if (t === "type_item") return "type";
    return "variable";
  },
};

const JAVA_CONFIG: LanguageConfig = {
  language: "java",
  extensions: [".java"],
  grammarModule: "tree-sitter-java",
  topLevelTypes: ["class_declaration", "interface_declaration", "enum_declaration", "method_declaration"],
  methodTypes: ["method_declaration", "constructor_declaration"],
  classTypes: ["class_declaration", "interface_declaration", "enum_declaration"],
  importTypes: ["import_declaration"],
  getNodeName: (node: any) => getNameChild(node),
  mapKind: (t: string) => {
    if (t === "method_declaration" || t === "constructor_declaration") return "method";
    if (t === "class_declaration") return "class";
    if (t === "interface_declaration") return "interface";
    if (t === "enum_declaration") return "enum";
    return "variable";
  },
};

const C_CONFIG: LanguageConfig = {
  language: "c",
  extensions: [".c", ".h"],
  grammarModule: "tree-sitter-c",
  topLevelTypes: ["function_definition", "declaration", "struct_specifier", "enum_specifier", "type_definition"],
  methodTypes: [],
  classTypes: ["struct_specifier", "enum_specifier"],
  importTypes: ["preproc_include"],
  getNodeName: (node: any) => {
    if (node.type === "function_definition") {
      const declarator = node.childForFieldName("declarator");
      if (declarator) {
        // Navigate to the identifier inside the function declarator
        return findIdentifier(declarator);
      }
    }
    return getNameChild(node);
  },
  mapKind: (t: string) => {
    if (t === "function_definition") return "function";
    if (t === "struct_specifier") return "class";
    if (t === "enum_specifier") return "enum";
    if (t === "type_definition") return "type";
    return "variable";
  },
};

const CPP_CONFIG: LanguageConfig = {
  language: "cpp",
  extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx"],
  grammarModule: "tree-sitter-cpp",
  topLevelTypes: ["function_definition", "class_specifier", "struct_specifier", "enum_specifier", "template_declaration", "namespace_definition"],
  methodTypes: ["function_definition"],
  classTypes: ["class_specifier", "struct_specifier"],
  importTypes: ["preproc_include"],
  getNodeName: (node: any) => {
    if (node.type === "function_definition") {
      const declarator = node.childForFieldName("declarator");
      if (declarator) {
        return findIdentifier(declarator);
      }
    }
    if (node.type === "template_declaration") {
      // Get the inner declaration name
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === "function_definition" || child.type === "class_specifier") {
          return C_CONFIG.getNodeName(child);
        }
      }
    }
    return getNameChild(node);
  },
  mapKind: (t: string) => {
    if (t === "function_definition") return "function";
    if (t === "class_specifier") return "class";
    if (t === "struct_specifier") return "class";
    if (t === "enum_specifier") return "enum";
    if (t === "namespace_definition") return "module" as ChunkKind;
    return "variable";
  },
};

const ALL_CONFIGS = [PYTHON_CONFIG, GO_CONFIG, RUST_CONFIG, JAVA_CONFIG, C_CONFIG, CPP_CONFIG];

// ─────────────────────────────────────────────
// Utility helpers for tree-sitter nodes
// ─────────────────────────────────────────────

function getNameChild(node: any): string | null {
  const nameNode = node.childForFieldName("name");
  return nameNode ? nameNode.text : null;
}

function findIdentifier(node: any): string | null {
  if (node.type === "identifier" || node.type === "field_identifier") {
    return node.text;
  }
  for (let i = 0; i < node.childCount; i++) {
    const result = findIdentifier(node.child(i));
    if (result) return result;
  }
  return null;
}

function getHash(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function extractCallDependencies(node: any, deps: Set<string>): void {
  if (node.type === "call_expression" || node.type === "call") {
    const funcNode = node.childForFieldName("function") || node.child(0);
    if (funcNode && funcNode.text) {
      deps.add(funcNode.text.split("(")[0]!.trim());
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    extractCallDependencies(node.child(i), deps);
  }
}

// ─────────────────────────────────────────────
// TreeSitterParser class
// ─────────────────────────────────────────────

/**
 * Generic tree-sitter parser that supports multiple languages
 * via configurable LanguageConfig objects.
 */
class TreeSitterParser implements LanguageParser {
  readonly name: string;
  readonly extensions: string[];

  private parser: any;
  private config: LanguageConfig;

  constructor(Parser: any, grammar: any, config: LanguageConfig) {
    this.name = `TreeSitter-${config.language}`;
    this.extensions = config.extensions;
    this.config = config;

    this.parser = new Parser();
    this.parser.setLanguage(grammar);
  }

  parse(filePath: string, source: string): Chunk[] {
    const tree = this.parser.parse(source);
    const chunks: Chunk[] = [];
    const rootNode = tree.rootNode;

    this.visitNode(rootNode, filePath, chunks);

    return chunks;
  }

  private visitNode(
    node: any,
    filePath: string,
    chunks: Chunk[],
    parentSymbol?: string,
    parentId?: string,
  ): void {
    const config = this.config;

    // Check if this is a top-level or class-level declaration
    const isTopLevel = config.topLevelTypes.includes(node.type);
    const isClass = config.classTypes.includes(node.type);
    const isMethod = config.methodTypes.includes(node.type) && parentSymbol;

    if (isTopLevel || isMethod) {
      const name = config.getNodeName(node);
      if (name) {
        const content = node.text;
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const kind = config.mapKind(node.type);
        const symbolPath = parentSymbol ? `${parentSymbol}.${name}` : name;
        const hash = getHash(content);

        // Extract dependencies from calls
        const deps = new Set<string>();
        extractCallDependencies(node, deps);

        // Extract imports at module level
        if (!parentSymbol) {
          this.extractImports(node, deps);
        }

        const chunk: Chunk = {
          id: `${symbolPath}:${hash.slice(0, 12)}`,
          file: filePath,
          language: config.language,
          name,
          symbolPath,
          kind,
          parent: parentSymbol,
          parentId,
          isExported: this.isExported(node),
          isAsync: this.isAsync(node),
          signature: this.buildSignature(node),
          dependencies: Array.from(deps),
          startLine,
          endLine,
          hash,
          content,
        };

        chunks.push(chunk);

        // If this is a class-like, visit children for methods
        if (isClass) {
          const bodyNode = node.childForFieldName("body") || node;
          for (let i = 0; i < bodyNode.childCount; i++) {
            const child = bodyNode.child(i);
            if (config.methodTypes.includes(child.type)) {
              this.visitNode(child, filePath, chunks, name, chunk.id);
            }
            // Handle decorated methods (Python)
            if (child.type === "decorated_definition") {
              this.visitNode(child, filePath, chunks, name, chunk.id);
            }
          }
          return; // Don't recurse into class body again
        }

        return; // Don't recurse into extracted functions
      }
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      this.visitNode(node.child(i), filePath, chunks, parentSymbol, parentId);
    }
  }

  private extractImports(node: any, deps: Set<string>): void {
    const config = this.config;
    // Walk the entire tree looking for imports
    const walk = (n: any) => {
      if (config.importTypes.includes(n.type)) {
        // Extract the module/path from the import
        const text = n.text;
        // Try to extract quoted strings (module paths)
        const quoteMatch = text.match(/["']([^"']+)["']/);
        if (quoteMatch) {
          deps.add(quoteMatch[1]!);
        }
        // Try to extract identifiers after 'import' or 'from'
        const identMatch = text.match(/(?:import|from)\s+([\w.]+)/);
        if (identMatch) {
          deps.add(identMatch[1]!);
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        walk(n.child(i));
      }
    };
    walk(node);
  }

  private isExported(node: any): boolean {
    const text = node.text;
    // Language-specific export detection
    if (this.config.language === "go") {
      const name = this.config.getNodeName(node);
      return name ? /^[A-Z]/.test(name) : false;
    }
    if (this.config.language === "rust") {
      return text.startsWith("pub ");
    }
    if (this.config.language === "java") {
      return text.includes("public ");
    }
    if (this.config.language === "python") {
      const name = this.config.getNodeName(node);
      return name ? !name.startsWith("_") : false;
    }
    return false;
  }

  private isAsync(node: any): boolean {
    const text = node.text;
    if (this.config.language === "python") return text.startsWith("async ");
    if (this.config.language === "rust") return text.includes("async fn");
    if (this.config.language === "java") return false; // Java doesn't have async keyword
    return false;
  }

  private buildSignature(node: any): string | undefined {
    const text: string = node.text;
    // Find the function body start and take everything before it
    const bodyStart = text.indexOf("{");
    if (bodyStart !== -1) {
      return text.slice(0, bodyStart).trim();
    }
    // Python: find the colon
    const colonIndex = text.indexOf(":");
    if (colonIndex !== -1 && this.config.language === "python") {
      return text.slice(0, colonIndex).trim();
    }
    return undefined;
  }
}

// ─────────────────────────────────────────────
// Factory function
// ─────────────────────────────────────────────

/**
 * Try to load native tree-sitter first, fall back to web-tree-sitter.
 * Returns an array of parser instances for all supported languages.
 */
export function createTreeSitterParsers(): LanguageParser[] {
  const parsers: LanguageParser[] = [];

  // Try native tree-sitter first
  let Parser: any;
  let useNative = false;

  try {
    Parser = require("tree-sitter");
    useNative = true;
  } catch {
    // Native bindings not available (no C++ compiler)
    // In the future, could fall back to web-tree-sitter here
    throw new Error("tree-sitter native bindings not available. Install a C++ compiler or use web-tree-sitter.");
  }

  for (const config of ALL_CONFIGS) {
    try {
      const grammar = require(config.grammarModule);
      const parser = new TreeSitterParser(Parser, grammar, config);
      parsers.push(parser);
    } catch (err) {
      console.warn(`[TreeSitter] Failed to load ${config.grammarModule}:`, (err as Error).message);
    }
  }

  return parsers;
}
