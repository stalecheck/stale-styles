import type { AstNode } from "./ast";
import {
  getIdentifierName,
  getStaticPropertyName,
  getStringLiteralValue,
  isAstNode,
  walkAst
} from "./ast";

export function createStaticResolver(
  program: AstNode
): (expression: AstNode) => string[] | undefined {
  const constants: ScopedBinding<string[] | undefined>[] = [];
  const objectConstants: ScopedBinding<Map<string, string[]>>[] = [];
  const typeAliases = new Map<string, string[]>();
  const objectTypeAliases = new Map<string, Map<string, string[]>>();

  walkAst(program, (node, ancestors) => {
    if (node.type === "TSTypeAliasDeclaration") {
      collectTypeAlias(node, objectConstants, typeAliases, objectTypeAliases);
      return;
    }

    if (node.type === "TSInterfaceDeclaration") {
      collectInterfaceDeclaration(node, objectConstants, typeAliases, objectTypeAliases);
      return;
    }

    if (node.type === "TSEnumDeclaration") {
      collectEnumDeclaration(node, ancestors, objectConstants);
      return;
    }

    if (node.type === "CallExpression") {
      collectForwardRefPropsBinding(
        node,
        ancestors,
        constants,
        objectConstants,
        typeAliases,
        objectTypeAliases
      );
      return;
    }

    if (node.type === "VariableDeclarator") {
      collectVariableDeclarator(node, ancestors, constants, objectConstants, typeAliases);
      return;
    }

    collectTypedBinding(
      node,
      ancestors,
      constants,
      objectConstants,
      typeAliases,
      objectTypeAliases
    );
  });

  return (expression: AstNode) => resolveExpression(expression, constants, objectConstants);
}

type ScopedBinding<T> = {
  name: string;
  value: T;
  declarationIndex: number;
  scopeStart: number;
  scopeEnd: number;
  scopeDepth: number;
};

function collectTypeAlias(
  node: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): void {
  const identifier = getIdentifierName(node.id);

  if (!identifier || !isAstNode(node.typeAnnotation)) {
    return;
  }

  const resolvedObject = resolveObjectTypeAnnotation(
    node.typeAnnotation,
    objectConstants,
    typeAliases,
    objectTypeAliases
  );

  if (resolvedObject) {
    objectTypeAliases.set(identifier, resolvedObject);
    return;
  }

  const resolved = resolveTypeAnnotation(node.typeAnnotation, objectConstants, typeAliases);

  if (resolved) {
    typeAliases.set(identifier, resolved);
  }
}

function collectInterfaceDeclaration(
  node: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): void {
  const identifier = getIdentifierName(node.id);
  const resolved = resolveInterfaceDeclaration(
    node,
    objectConstants,
    typeAliases,
    objectTypeAliases
  );

  if (identifier && resolved) {
    objectTypeAliases.set(identifier, resolved);
  }
}

function resolveInterfaceDeclaration(
  node: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): Map<string, string[]> | undefined {
  const properties = new Map<string, string[]>();
  const heritageEntries = Array.isArray(node.extends) ? node.extends : [];

  for (const heritage of heritageEntries) {
    if (!isAstNode(heritage)) {
      continue;
    }

    const baseName = getIdentifierName(heritage.expression);
    const baseProperties = baseName ? objectTypeAliases.get(baseName) : undefined;

    if (baseProperties) {
      mergeObjectTypeProperties(properties, baseProperties);
    }
  }

  const ownProperties = isAstNode(node.body)
    ? resolveObjectTypeMembers(node.body.body, objectConstants, typeAliases)
    : undefined;

  if (ownProperties) {
    mergeObjectTypeProperties(properties, ownProperties);
  }

  return properties.size > 0 ? properties : undefined;
}

function collectEnumDeclaration(
  node: AstNode,
  ancestors: AstNode[],
  objectConstants: ScopedBinding<Map<string, string[]>>[]
): void {
  const identifier = getIdentifierName(node.id);
  const members = isAstNode(node.body) && Array.isArray(node.body.members) ? node.body.members : [];
  const enumValues = new Map<string, string[]>();

  if (!identifier) {
    return;
  }

  for (const member of members) {
    if (!isAstNode(member)) {
      continue;
    }

    const key = getStaticPropertyName(member.id);
    const value = isAstNode(member.initializer)
      ? getStringLiteralValue(member.initializer)
      : undefined;

    if (key && value !== undefined) {
      enumValues.set(key, [value]);
    }
  }

  if (enumValues.size > 0) {
    objectConstants.push(createScopedBinding(identifier, enumValues, node, ancestors));
  }
}

function collectVariableDeclarator(
  node: AstNode,
  ancestors: AstNode[],
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>
): void {
  const identifier = getIdentifierName(node.id);

  if (!identifier || !isAstNode(node.init)) {
    return;
  }

  const typedValues =
    isAstNode(node.id) && isAstNode(node.id.typeAnnotation)
      ? resolveTypeAnnotation(node.id.typeAnnotation, objectConstants, typeAliases)
      : undefined;

  if (typedValues) {
    constants.push(createScopedBinding(identifier, typedValues, node, ancestors));
    return;
  }

  const objectResolved = resolveObjectExpression(node.init, constants, objectConstants);

  if (objectResolved) {
    objectConstants.push(createScopedBinding(identifier, objectResolved, node, ancestors));
    return;
  }

  const resolved = resolveExpression(node.init, constants, objectConstants);

  if (resolved) {
    constants.push(createScopedBinding(identifier, resolved, node, ancestors));
  }
}

function collectForwardRefPropsBinding(
  node: AstNode,
  ancestors: AstNode[],
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): void {
  if (!isForwardRefCall(node)) {
    return;
  }

  const propsType = getForwardRefPropsType(node);
  const renderFunction = Array.isArray(node.arguments) ? node.arguments[0] : undefined;

  if (!isAstNode(propsType) || !isAstNode(renderFunction) || !isFunctionNode(renderFunction)) {
    return;
  }

  const propsParam = Array.isArray(renderFunction.params) ? renderFunction.params[0] : undefined;

  if (!isAstNode(propsParam) || propsParam.type !== "ObjectPattern") {
    return;
  }

  collectObjectPatternTypedBindings(
    propsParam,
    propsType,
    [...ancestors, node, renderFunction],
    constants,
    objectConstants,
    typeAliases,
    objectTypeAliases
  );
}

function collectTypedBinding(
  node: AstNode,
  ancestors: AstNode[],
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): void {
  const identifier = getIdentifierName(node);

  if (identifier && isAstNode(node.typeAnnotation)) {
    const resolved = resolveTypeAnnotation(node.typeAnnotation, objectConstants, typeAliases);

    constants.push(createScopedBinding(identifier, resolved, node, ancestors));
  }

  if (node.type !== "ObjectPattern" || !isAstNode(node.typeAnnotation)) {
    return;
  }

  collectObjectPatternTypedBindings(
    node,
    node.typeAnnotation,
    ancestors,
    constants,
    objectConstants,
    typeAliases,
    objectTypeAliases
  );
}

function collectObjectPatternTypedBindings(
  node: AstNode,
  annotation: AstNode,
  ancestors: AstNode[],
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): void {
  const objectTypeProperties = getObjectTypeProperties(
    annotation,
    objectConstants,
    typeAliases,
    objectTypeAliases
  );
  if (!objectTypeProperties) {
    for (const bindingName of collectObjectPatternBindingNames(node)) {
      constants.push(createScopedBinding(bindingName, undefined, node, ancestors));
    }
    return;
  }

  const collectedBindingNames = new Set<string>();

  for (const [propertyName, propertyValues] of objectTypeProperties) {
    const bindingName = findObjectPatternBindingName(node, propertyName);

    if (bindingName) {
      collectedBindingNames.add(bindingName);
      constants.push(createScopedBinding(bindingName, propertyValues, node, ancestors));
    }
  }

  for (const bindingName of collectObjectPatternBindingNames(node)) {
    if (!collectedBindingNames.has(bindingName)) {
      constants.push(createScopedBinding(bindingName, undefined, node, ancestors));
    }
  }
}

function isForwardRefCall(node: AstNode): boolean {
  const callee = node.callee;

  if (getIdentifierName(callee) === "forwardRef") {
    return true;
  }

  if (!isAstNode(callee) || callee.type !== "MemberExpression") {
    return false;
  }

  return getStaticPropertyName(callee.property) === "forwardRef";
}

function getForwardRefPropsType(node: AstNode): unknown {
  const typeArguments = node.typeArguments;

  return isAstNode(typeArguments) && Array.isArray(typeArguments.params)
    ? typeArguments.params[1]
    : undefined;
}

function isFunctionNode(node: AstNode): boolean {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function resolveExpression(
  expression: AstNode,
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[]
): string[] | undefined {
  const literal = getStaticPrimitiveValue(expression);

  if (literal !== undefined) {
    return [literal];
  }

  if (expression.type === "TemplateLiteral") {
    return resolveTemplateLiteral(expression, constants, objectConstants);
  }

  const identifier = getIdentifierName(expression);

  if (identifier) {
    return findVisibleBinding(constants, identifier, expression)?.value;
  }

  if (expression.type === "MemberExpression") {
    const objectName = getIdentifierName(expression.object);
    const propertyName = getStaticPropertyName(expression.property);

    if (objectName && propertyName) {
      return findVisibleBinding(objectConstants, objectName, expression)?.value.get(propertyName);
    }
  }

  if (expression.type === "ConditionalExpression") {
    const consequent = isAstNode(expression.consequent)
      ? resolveExpression(expression.consequent, constants, objectConstants)
      : undefined;
    const alternate = isAstNode(expression.alternate)
      ? resolveExpression(expression.alternate, constants, objectConstants)
      : undefined;

    if (consequent && alternate) {
      return [...consequent, ...alternate];
    }
  }

  if (
    (expression.type === "ParenthesizedExpression" ||
      expression.type === "TSAsExpression" ||
      expression.type === "TSSatisfiesExpression" ||
      expression.type === "TSNonNullExpression" ||
      expression.type === "TSTypeAssertion") &&
    isAstNode(expression.expression)
  ) {
    return resolveExpression(expression.expression, constants, objectConstants);
  }

  return undefined;
}

function getObjectTypeProperties(
  annotation: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): Map<string, string[]> | undefined {
  const typeNode = getTypeAnnotationBody(annotation);

  if (!typeNode) {
    return undefined;
  }

  if (typeNode.type === "TSTypeLiteral") {
    return resolveObjectTypeAnnotation(typeNode, objectConstants, typeAliases, objectTypeAliases);
  }

  if (typeNode.type === "TSIntersectionType") {
    return resolveObjectTypeAnnotation(typeNode, objectConstants, typeAliases, objectTypeAliases);
  }

  if (typeNode.type === "TSTypeReference") {
    const typeName = getIdentifierName(typeNode.typeName);
    return typeName ? objectTypeAliases.get(typeName) : undefined;
  }

  return undefined;
}

function resolveObjectTypeAnnotation(
  annotation: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>,
  objectTypeAliases: Map<string, Map<string, string[]>>
): Map<string, string[]> | undefined {
  const typeNode = getTypeAnnotationBody(annotation);

  if (!typeNode) {
    return undefined;
  }

  if (typeNode.type === "TSTypeLiteral") {
    return resolveObjectTypeMembers(typeNode.members, objectConstants, typeAliases);
  }

  if (typeNode.type === "TSTypeReference") {
    const typeName = getIdentifierName(typeNode.typeName);
    return typeName ? objectTypeAliases.get(typeName) : undefined;
  }

  if (typeNode.type !== "TSIntersectionType" || !Array.isArray(typeNode.types)) {
    return undefined;
  }

  const properties = new Map<string, string[]>();

  for (const childType of typeNode.types) {
    if (!isAstNode(childType)) {
      continue;
    }

    const childProperties = resolveObjectTypeAnnotation(
      childType,
      objectConstants,
      typeAliases,
      objectTypeAliases
    );

    if (!childProperties) {
      continue;
    }

    mergeObjectTypeProperties(properties, childProperties);
  }

  return properties.size > 0 ? properties : undefined;
}

function mergeObjectTypeProperties(
  target: Map<string, string[]>,
  source: Map<string, string[]>
): void {
  for (const [propertyName, propertyValues] of source) {
    target.set(propertyName, propertyValues);
  }
}

function resolveObjectTypeMembers(
  members: unknown,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>
): Map<string, string[]> | undefined {
  if (!Array.isArray(members)) {
    return undefined;
  }

  const properties = new Map<string, string[]>();

  for (const member of members) {
    if (!isAstNode(member) || member.type !== "TSPropertySignature") {
      return undefined;
    }

    const propertyName = getStaticPropertyName(member.key);
    const propertyValues = isAstNode(member.typeAnnotation)
      ? resolveTypeAnnotation(member.typeAnnotation, objectConstants, typeAliases)
      : undefined;

    if (!propertyName || !propertyValues) {
      continue;
    }

    properties.set(propertyName, propertyValues);
  }

  return properties.size > 0 ? properties : undefined;
}

function resolveObjectExpression(
  expression: AstNode,
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[]
): Map<string, string[]> | undefined {
  const objectExpression =
    expression.type === "TSAsExpression" && isAstNode(expression.expression)
      ? expression.expression
      : expression;

  if (objectExpression.type !== "ObjectExpression") {
    return undefined;
  }

  const properties = Array.isArray(objectExpression.properties) ? objectExpression.properties : [];
  const result = new Map<string, string[]>();

  for (const property of properties) {
    if (!isAstNode(property) || property.type !== "Property" || property.computed === true) {
      return undefined;
    }

    const key = getStaticPropertyName(property.key);
    const value = isAstNode(property.value)
      ? resolveExpression(property.value, constants, objectConstants)
      : undefined;

    if (!key || !value) {
      return undefined;
    }

    result.set(key, value);
  }

  return result;
}

function resolveTemplateLiteral(
  expression: AstNode,
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[]
): string[] | undefined {
  const quasis = Array.isArray(expression.quasis) ? expression.quasis : [];
  const expressions = Array.isArray(expression.expressions) ? expression.expressions : [];

  if (quasis.length !== expressions.length + 1) {
    return undefined;
  }

  const resolvedExpressions: string[][] = [];

  for (const childExpression of expressions) {
    if (!isAstNode(childExpression)) {
      return undefined;
    }

    const resolved = resolveExpression(childExpression, constants, objectConstants);

    if (!resolved) {
      return undefined;
    }

    resolvedExpressions.push(resolved);
  }

  const firstQuasi = getTemplateQuasiValue(quasis[0]);

  if (firstQuasi === undefined) {
    return undefined;
  }

  let results: string[] = [firstQuasi];

  for (let index = 0; index < resolvedExpressions.length; index += 1) {
    const nextQuasi = getTemplateQuasiValue(quasis[index + 1]);

    if (nextQuasi === undefined) {
      return undefined;
    }

    results = results.flatMap((prefix) =>
      resolvedExpressions[index].map((resolvedValue) => `${prefix}${resolvedValue}${nextQuasi}`)
    );
  }

  return results;
}

function getTemplateQuasiValue(quasi: unknown): string | undefined {
  if (!isAstNode(quasi)) {
    return undefined;
  }

  const value = quasi.value;

  return typeof value === "object" &&
    value !== null &&
    "cooked" in value &&
    typeof value.cooked === "string"
    ? value.cooked
    : undefined;
}

function resolveTypeAnnotation(
  annotation: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<string, string[]>
): string[] | undefined {
  const typeNode = getTypeAnnotationBody(annotation);

  if (!typeNode) {
    return undefined;
  }

  if (typeNode.type === "TSLiteralType") {
    const value = getStaticPrimitiveValue(typeNode.literal);
    return value === undefined ? undefined : [value];
  }

  if (typeNode.type === "TSUnionType" && Array.isArray(typeNode.types)) {
    const values: string[] = [];

    for (const childType of typeNode.types) {
      if (!isAstNode(childType)) {
        return undefined;
      }

      const childValues = resolveTypeAnnotation(childType, objectConstants, typeAliases);

      if (!childValues) {
        return undefined;
      }

      values.push(...childValues);
    }

    return values;
  }

  if (typeNode.type === "TSParenthesizedType") {
    return isAstNode(typeNode.typeAnnotation)
      ? resolveTypeAnnotation(typeNode.typeAnnotation, objectConstants, typeAliases)
      : undefined;
  }

  if (typeNode.type === "TSTypeReference") {
    const typeName = getIdentifierName(typeNode.typeName);
    return typeName
      ? (typeAliases.get(typeName) ??
          resolveObjectConstantValues(
            findVisibleBinding(objectConstants, typeName, typeNode)?.value
          ))
      : undefined;
  }

  if (typeNode.type === "TSIndexedAccessType") {
    return resolveIndexedAccessType(typeNode, objectConstants);
  }

  return undefined;
}

function resolveIndexedAccessType(
  typeNode: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[]
): string[] | undefined {
  const objectName = getTypeQueryName(typeNode.objectType);

  if (!objectName || !isKeyofTypeQuery(typeNode.indexType, objectName)) {
    return undefined;
  }

  const objectValues = findVisibleBinding(objectConstants, objectName, typeNode)?.value;

  return resolveObjectConstantValues(objectValues);
}

function resolveObjectConstantValues(
  objectValues: Map<string, string[]> | undefined
): string[] | undefined {
  return objectValues ? [...new Set([...objectValues.values()].flat())] : undefined;
}

function isKeyofTypeQuery(node: unknown, objectName: string): boolean {
  return (
    isAstNode(node) &&
    node.type === "TSTypeOperator" &&
    node.operator === "keyof" &&
    getTypeQueryName(node.typeAnnotation) === objectName
  );
}

function getTypeQueryName(node: unknown): string | undefined {
  if (!isAstNode(node)) {
    return undefined;
  }

  if (node.type === "TSParenthesizedType") {
    return getTypeQueryName(node.typeAnnotation);
  }

  return node.type === "TSTypeQuery" ? getIdentifierName(node.exprName) : undefined;
}

function getTypeAnnotationBody(annotation: AstNode): AstNode | undefined {
  if (annotation.type === "TSTypeAnnotation" && isAstNode(annotation.typeAnnotation)) {
    return annotation.typeAnnotation;
  }

  return annotation;
}

function getStaticPrimitiveValue(node: unknown): string | undefined {
  if (!isAstNode(node) || node.type !== "Literal") {
    return undefined;
  }

  if (typeof node.value === "string") {
    return node.value;
  }

  if (typeof node.value === "number" && Number.isFinite(node.value)) {
    return String(node.value);
  }

  return undefined;
}

function createScopedBinding<T>(
  name: string,
  value: T,
  node: AstNode,
  ancestors: AstNode[]
): ScopedBinding<T> {
  const scope = getNearestValueScope(node, ancestors);

  return {
    name,
    value,
    declarationIndex: node.start ?? 0,
    scopeStart: scope.start ?? 0,
    scopeEnd: scope.end ?? Number.POSITIVE_INFINITY,
    scopeDepth: scope.depth
  };
}

function getNearestValueScope(node: AstNode, ancestors: AstNode[]): AstNode & { depth: number } {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];

    if (isValueScope(ancestor)) {
      return { ...ancestor, depth: index };
    }
  }

  return { ...node, start: 0, end: Number.POSITIVE_INFINITY, depth: 0 };
}

function isValueScope(node: AstNode): boolean {
  return (
    node.type === "Program" ||
    node.type === "BlockStatement" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function findVisibleBinding<T>(
  bindings: ScopedBinding<T>[],
  name: string,
  expression: AstNode
): ScopedBinding<T> | undefined {
  const index = expression.start ?? 0;

  return bindings
    .filter((binding) => {
      return (
        binding.name === name &&
        binding.declarationIndex <= index &&
        binding.scopeStart <= index &&
        index <= binding.scopeEnd
      );
    })
    .sort((left, right) => {
      return (
        right.scopeDepth - left.scopeDepth ||
        right.scopeStart - left.scopeStart ||
        right.declarationIndex - left.declarationIndex
      );
    })[0];
}

function findObjectPatternBindingName(pattern: AstNode, propertyName: string): string | undefined {
  const properties = Array.isArray(pattern.properties) ? pattern.properties : [];

  for (const property of properties) {
    if (!isAstNode(property) || property.type !== "Property") {
      continue;
    }

    if (getStaticPropertyName(property.key) !== propertyName) {
      continue;
    }

    return getBindingName(property.value);
  }

  return undefined;
}

function collectObjectPatternBindingNames(pattern: AstNode): string[] {
  const properties = Array.isArray(pattern.properties) ? pattern.properties : [];

  return properties.flatMap((property) => {
    if (!isAstNode(property)) {
      return [];
    }

    if (property.type === "RestElement") {
      return collectBindingNames(property.argument);
    }

    if (property.type === "Property") {
      return collectBindingNames(property.value);
    }

    return [];
  });
}

function collectBindingNames(node: unknown): string[] {
  const identifier = getIdentifierName(node);

  if (identifier) {
    return [identifier];
  }

  if (!isAstNode(node)) {
    return [];
  }

  if (node.type === "AssignmentPattern") {
    return collectBindingNames(node.left);
  }

  if (node.type === "RestElement") {
    return collectBindingNames(node.argument);
  }

  if (node.type === "ObjectPattern") {
    return collectObjectPatternBindingNames(node);
  }

  if (node.type === "ArrayPattern") {
    const elements = Array.isArray(node.elements) ? node.elements : [];

    return elements.flatMap((element) => collectBindingNames(element));
  }

  return [];
}

function getBindingName(node: unknown): string | undefined {
  const identifier = getIdentifierName(node);

  if (identifier) {
    return identifier;
  }

  if (isAstNode(node) && node.type === "AssignmentPattern") {
    return getBindingName(node.left);
  }

  return undefined;
}
