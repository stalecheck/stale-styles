import { getLocation } from "../locations";
import type { ClassUsage, CssModuleImport, SourceLocation } from "../types";
import type { AstNode } from "./ast";
import { getIdentifierName, getStringLiteralValue, isAstNode, walkAst } from "./ast";
import { createStaticResolver } from "./resolve-static";

type RawClassUsage = {
  className: string;
  location: SourceLocation;
};

export function findCssModuleClassUsages(
  source: string,
  program: AstNode,
  imports: CssModuleImport[]
): ClassUsage[] {
  const usages: ClassUsage[] = [];
  const resolveStatic = createStaticResolver(program);
  const importsByLocalName = new Map(
    imports
      .filter((cssImport): cssImport is CssModuleImport & { localName: string } => {
        return typeof cssImport.localName === "string";
      })
      .map((cssImport) => [cssImport.localName, cssImport])
  );
  const namedImportsByLocalName = new Map(
    imports.flatMap((cssImport) => {
      return cssImport.namedImports.map((namedImport) => [
        namedImport.localName,
        { cssImport, namedImport }
      ]);
    })
  );

  walkAst(program, (node, ancestors) => {
    const identifierName = getIdentifierName(node);
    const namedImport = identifierName ? namedImportsByLocalName.get(identifierName) : undefined;

    if (
      namedImport &&
      !isNonUsageIdentifier(node, ancestors) &&
      !isShadowedReference(identifierName, node, ancestors)
    ) {
      usages.push({
        kind: "resolved",
        localName: namedImport.namedImport.localName,
        className: namedImport.namedImport.importedName,
        cssModulePath: namedImport.cssImport.cssModulePath,
        location: getLocation(source, node.start ?? 0)
      });
      return;
    }

    if (node.type !== "MemberExpression") {
      return;
    }

    const objectName = getIdentifierName(node.object);
    const cssImport = objectName ? importsByLocalName.get(objectName) : undefined;

    if (!cssImport || isShadowedReference(objectName, node.object, ancestors)) {
      return;
    }

    const location = getLocation(source, node.start ?? 0);

    if (node.computed === false) {
      const className = getIdentifierName(node.property);

      if (!className) {
        return;
      }

      usages.push({
        kind: "resolved",
        localName: cssImport.localName,
        className,
        cssModulePath: cssImport.cssModulePath,
        location
      });
      return;
    }

    if (!isAstNode(node.property)) {
      return;
    }

    const resolved = resolveStatic(node.property);

    if (!resolved) {
      usages.push({
        kind: "unresolved",
        localName: cssImport.localName,
        cssModulePath: cssImport.cssModulePath,
        location
      });
      return;
    }

    for (const className of resolved) {
      usages.push({
        kind: "resolved",
        localName: cssImport.localName,
        className,
        cssModulePath: cssImport.cssModulePath,
        location
      });
    }
  });

  return usages;
}

function isNonUsageIdentifier(node: AstNode, ancestors: AstNode[]): boolean {
  const parent = ancestors.at(-1);

  if (ancestors.some((ancestor) => ancestor.type === "ImportDeclaration")) {
    return true;
  }

  if (parent?.type === "MemberExpression" && parent.property === node && parent.computed !== true) {
    return true;
  }

  if (parent?.type === "Property" && parent.key === node && parent.computed !== true) {
    return true;
  }

  if (parent?.type === "TSPropertySignature" && parent.key === node && parent.computed !== true) {
    return true;
  }

  return false;
}

function isShadowedReference(
  name: string | undefined,
  reference: unknown,
  ancestors: AstNode[]
): boolean {
  if (!name || !isAstNode(reference)) {
    return false;
  }

  const referenceIndex = reference.start ?? 0;

  return ancestors.some((ancestor) => {
    if (!createsLocalScope(ancestor)) {
      return false;
    }

    return hasLocalBindingBeforeReference(ancestor, name, referenceIndex);
  });
}

function createsLocalScope(node: AstNode): boolean {
  return (
    node.type === "BlockStatement" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function hasLocalBindingBeforeReference(
  scope: AstNode,
  name: string,
  referenceIndex: number
): boolean {
  if (declaresParameter(scope, name)) {
    return true;
  }

  return hasVariableBindingBeforeReference(scope, name, referenceIndex);
}

function declaresParameter(scope: AstNode, name: string): boolean {
  const params = Array.isArray(scope.params) ? scope.params : [];

  return params.some((param) => bindingContainsName(param, name));
}

function hasVariableBindingBeforeReference(
  node: AstNode,
  name: string,
  referenceIndex: number
): boolean {
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "params" || key === "id") {
      continue;
    }

    if (Array.isArray(value)) {
      if (
        value.some((item) => hasVariableBindingBeforeReferenceInChild(item, name, referenceIndex))
      ) {
        return true;
      }

      continue;
    }

    if (hasVariableBindingBeforeReferenceInChild(value, name, referenceIndex)) {
      return true;
    }
  }

  return false;
}

function hasVariableBindingBeforeReferenceInChild(
  child: unknown,
  name: string,
  referenceIndex: number
): boolean {
  if (!isAstNode(child)) {
    return false;
  }

  if ((child.start ?? Number.POSITIVE_INFINITY) > referenceIndex) {
    return false;
  }

  if (child.type === "FunctionDeclaration") {
    return bindingContainsName(child.id, name) && (child.start ?? 0) <= referenceIndex;
  }

  if (
    child.type === "FunctionExpression" ||
    child.type === "ArrowFunctionExpression" ||
    child.type === "ClassDeclaration" ||
    child.type === "ClassExpression"
  ) {
    return false;
  }

  if (child.type === "VariableDeclarator") {
    return bindingContainsName(child.id, name) && (child.start ?? 0) <= referenceIndex;
  }

  return hasVariableBindingBeforeReference(child, name, referenceIndex);
}

function bindingContainsName(binding: unknown, name: string): boolean {
  if (!isAstNode(binding)) {
    return false;
  }

  if (getIdentifierName(binding) === name) {
    return true;
  }

  if (binding.type === "AssignmentPattern") {
    return bindingContainsName(binding.left, name);
  }

  if (binding.type === "RestElement") {
    return bindingContainsName(binding.argument, name);
  }

  if (binding.type === "ObjectPattern") {
    const properties = Array.isArray(binding.properties) ? binding.properties : [];

    return properties.some((property) => {
      if (!isAstNode(property)) {
        return false;
      }

      if (property.type === "RestElement") {
        return bindingContainsName(property.argument, name);
      }

      return bindingContainsName(property.value, name);
    });
  }

  if (binding.type === "ArrayPattern") {
    const elements = Array.isArray(binding.elements) ? binding.elements : [];

    return elements.some((element) => bindingContainsName(element, name));
  }

  return false;
}

export function findRawClassNameUsages(source: string, program: AstNode): RawClassUsage[] {
  const usages: RawClassUsage[] = [];
  const classComposerLocalNames = findClassComposerLocalNames(program);

  walkAst(program, (node) => {
    if (!isClassAttribute(node)) {
      return;
    }

    const value = node.value;

    if (!isAstNode(value)) {
      return;
    }

    const rawAttribute = getStringLiteralValue(value);

    if (rawAttribute !== undefined) {
      pushClassTokens(usages, source, rawAttribute, value.start ?? node.start ?? 0);
      return;
    }

    if (value.type !== "JSXExpressionContainer" || !isAstNode(value.expression)) {
      return;
    }

    collectRawClassExpressionUsages(
      usages,
      source,
      value.expression,
      value.start ?? node.start ?? 0,
      classComposerLocalNames
    );
  });

  return usages;
}

function isClassAttribute(node: AstNode): node is AstNode & { value: unknown } {
  return (
    node.type === "JSXAttribute" &&
    isAstNode(node.name) &&
    node.name.type === "JSXIdentifier" &&
    (node.name.name === "className" || node.name.name === "class")
  );
}

function findClassComposerLocalNames(program: AstNode): Set<string> {
  const classComposerLocalNames = new Set<string>();
  const body = Array.isArray(program.body) ? program.body : [];

  for (const statement of body) {
    if (!isAstNode(statement) || statement.type !== "ImportDeclaration") {
      continue;
    }

    const importPath = getStringLiteralValue(statement.source);

    if (importPath !== "clsx" && importPath !== "classnames") {
      continue;
    }

    const specifiers = Array.isArray(statement.specifiers) ? statement.specifiers : [];

    for (const specifier of specifiers) {
      if (!isAstNode(specifier)) {
        continue;
      }

      if (specifier.type === "ImportDefaultSpecifier") {
        const localName = getIdentifierName(specifier.local);

        if (localName) {
          classComposerLocalNames.add(localName);
        }
        continue;
      }

      if (specifier.type !== "ImportSpecifier") {
        continue;
      }

      const importedName = getIdentifierName(specifier.imported);
      const localName = getIdentifierName(specifier.local);

      if (
        localName &&
        (importedName === "clsx" || importedName === "classNames" || importedName === "classnames")
      ) {
        classComposerLocalNames.add(localName);
      }
    }
  }

  return classComposerLocalNames;
}

function isClassComposerCall(node: AstNode, classComposerLocalNames: Set<string>): boolean {
  return classComposerLocalNames.has(getIdentifierName(node.callee) ?? "");
}

function getStaticClassObjectKey(node: AstNode): string | undefined {
  const key = node.key;

  if (!isAstNode(key)) {
    return undefined;
  }

  if (key.type === "Identifier") {
    return typeof key.name === "string" ? key.name : undefined;
  }

  return getStringLiteralValue(key);
}

function collectRawClassExpressionUsages(
  usages: RawClassUsage[],
  source: string,
  node: AstNode,
  fallbackIndex: number,
  classComposerLocalNames: Set<string>
): void {
  const stringValue = getStringLiteralValue(node);

  if (stringValue !== undefined) {
    pushClassTokens(usages, source, stringValue, node.start ?? fallbackIndex);
    return;
  }

  if (node.type === "MemberExpression") {
    return;
  }

  if (node.type === "TemplateLiteral") {
    collectTemplateLiteralRawClassUsages(
      usages,
      source,
      node,
      fallbackIndex,
      classComposerLocalNames
    );
    return;
  }

  if (node.type === "TaggedTemplateExpression") {
    collectChildRawClassUsages(usages, source, node.quasi, fallbackIndex, classComposerLocalNames);
    return;
  }

  if (node.type === "SpreadElement") {
    collectChildRawClassUsages(
      usages,
      source,
      node.argument,
      fallbackIndex,
      classComposerLocalNames
    );
    return;
  }

  if (node.type === "BinaryExpression") {
    if (node.operator === "+") {
      collectChildRawClassUsages(usages, source, node.left, fallbackIndex, classComposerLocalNames);
      collectChildRawClassUsages(
        usages,
        source,
        node.right,
        fallbackIndex,
        classComposerLocalNames
      );
    }
    return;
  }

  if (node.type === "LogicalExpression") {
    collectChildRawClassUsages(usages, source, node.right, fallbackIndex, classComposerLocalNames);
    return;
  }

  if (node.type === "ConditionalExpression") {
    collectChildRawClassUsages(
      usages,
      source,
      node.consequent,
      fallbackIndex,
      classComposerLocalNames
    );
    collectChildRawClassUsages(
      usages,
      source,
      node.alternate,
      fallbackIndex,
      classComposerLocalNames
    );
    return;
  }

  if (node.type === "ArrayExpression") {
    const elements = Array.isArray(node.elements) ? node.elements : [];

    for (const element of elements) {
      collectChildRawClassUsages(usages, source, element, fallbackIndex, classComposerLocalNames);
    }
    return;
  }

  if (node.type === "ObjectExpression") {
    collectObjectRawClassUsages(usages, source, node, fallbackIndex, classComposerLocalNames);
    return;
  }

  if (node.type === "CallExpression") {
    if (!isClassComposerCall(node, classComposerLocalNames)) {
      return;
    }

    const args = Array.isArray(node.arguments) ? node.arguments : [];

    for (const arg of args) {
      collectChildRawClassUsages(usages, source, arg, fallbackIndex, classComposerLocalNames);
    }
    return;
  }

  if (isExpressionWrapper(node)) {
    collectChildRawClassUsages(
      usages,
      source,
      node.expression,
      fallbackIndex,
      classComposerLocalNames
    );
    return;
  }

  if (node.type === "SequenceExpression") {
    const expressions = Array.isArray(node.expressions) ? node.expressions : [];
    const lastExpression = expressions.at(-1);

    collectChildRawClassUsages(
      usages,
      source,
      lastExpression,
      fallbackIndex,
      classComposerLocalNames
    );
  }
}

function collectChildRawClassUsages(
  usages: RawClassUsage[],
  source: string,
  node: unknown,
  fallbackIndex: number,
  classComposerLocalNames: Set<string>
): void {
  if (!isAstNode(node)) {
    return;
  }

  collectRawClassExpressionUsages(usages, source, node, fallbackIndex, classComposerLocalNames);
}

function collectTemplateLiteralRawClassUsages(
  usages: RawClassUsage[],
  source: string,
  node: AstNode,
  fallbackIndex: number,
  classComposerLocalNames: Set<string>
): void {
  const templateValue = getStaticTemplateValue(node);

  if (templateValue !== undefined) {
    pushClassTokens(usages, source, templateValue, node.start ?? fallbackIndex);
    return;
  }

  const quasis = Array.isArray(node.quasis) ? node.quasis : [];
  const expressions = Array.isArray(node.expressions) ? node.expressions : [];

  for (const quasi of quasis) {
    const quasiValue = getTemplateQuasiValue(quasi);

    if (quasiValue !== undefined && isAstNode(quasi)) {
      pushClassTokens(usages, source, quasiValue, quasi.start ?? fallbackIndex);
    }
  }

  for (const expression of expressions) {
    collectChildRawClassUsages(usages, source, expression, fallbackIndex, classComposerLocalNames);
  }
}

function collectObjectRawClassUsages(
  usages: RawClassUsage[],
  source: string,
  node: AstNode,
  fallbackIndex: number,
  classComposerLocalNames: Set<string>
): void {
  const properties = Array.isArray(node.properties) ? node.properties : [];

  for (const property of properties) {
    if (!isAstNode(property)) {
      continue;
    }

    if (property.type === "SpreadElement") {
      collectChildRawClassUsages(
        usages,
        source,
        property.argument,
        fallbackIndex,
        classComposerLocalNames
      );
      continue;
    }

    if (property.type !== "Property") {
      continue;
    }

    if (property.computed === true) {
      collectChildRawClassUsages(
        usages,
        source,
        property.key,
        fallbackIndex,
        classComposerLocalNames
      );
      continue;
    }

    const key = getStaticClassObjectKey(property);

    if (key !== undefined) {
      pushClassTokens(usages, source, key, property.start ?? fallbackIndex);
    }
  }
}

function isExpressionWrapper(node: AstNode): boolean {
  return (
    (node.type === "ChainExpression" ||
      node.type === "ParenthesizedExpression" ||
      node.type === "TSAsExpression" ||
      node.type === "TSInstantiationExpression" ||
      node.type === "TSNonNullExpression" ||
      node.type === "TSSatisfiesExpression" ||
      node.type === "TSTypeAssertion") &&
    isAstNode(node.expression)
  );
}

function getStaticTemplateValue(node: AstNode): string | undefined {
  const expressions = Array.isArray(node.expressions) ? node.expressions : [];

  if (expressions.length > 0) {
    return undefined;
  }

  const quasi =
    Array.isArray(node.quasis) && isAstNode(node.quasis[0]) ? node.quasis[0] : undefined;
  const value = quasi?.value;

  return typeof value === "object" &&
    value !== null &&
    "cooked" in value &&
    typeof value.cooked === "string"
    ? value.cooked
    : undefined;
}

function getTemplateQuasiValue(node: unknown): string | undefined {
  if (!isAstNode(node)) {
    return undefined;
  }

  const value = node.value;

  return typeof value === "object" &&
    value !== null &&
    "cooked" in value &&
    typeof value.cooked === "string"
    ? value.cooked
    : undefined;
}

function pushClassTokens(
  usages: RawClassUsage[],
  source: string,
  value: string,
  index: number
): void {
  const tokens = value.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    usages.push({
      className: token,
      location: getLocation(source, index)
    });
  }
}
