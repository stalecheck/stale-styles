import { analyze, type Variable } from "@typescript-eslint/scope-manager";
import { visitorKeys } from "oxc-parser";
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
  const semanticVariables = createSemanticVariableMap(program);
  const constants: ScopedBinding<string[] | undefined>[] = [];
  const objectConstants: ScopedBinding<Map<string, string[]>>[] = [];
  const typeAliases = new Map<Variable, string[]>();
  const objectTypeAliases = new Map<Variable, Map<string, string[]>>();

  walkAst(program, (node) => {
    if (node.type === "TSTypeAliasDeclaration") {
      collectTypeAlias(node, objectConstants, typeAliases, objectTypeAliases, semanticVariables);
      return;
    }

    if (node.type === "TSInterfaceDeclaration") {
      collectInterfaceDeclaration(
        node,
        objectConstants,
        typeAliases,
        objectTypeAliases,
        semanticVariables
      );
      return;
    }

    if (node.type === "TSEnumDeclaration") {
      collectEnumDeclaration(node, objectConstants, semanticVariables);
      return;
    }

    if (node.type === "CallExpression") {
      collectForwardRefPropsBinding(
        node,
        constants,
        objectConstants,
        typeAliases,
        objectTypeAliases,
        semanticVariables
      );
      return;
    }

    if (node.type === "VariableDeclarator") {
      collectVariableDeclarator(node, constants, objectConstants, typeAliases, semanticVariables);
      return;
    }

    collectTypedBinding(
      node,
      constants,
      objectConstants,
      typeAliases,
      objectTypeAliases,
      semanticVariables
    );
  });

  return (expression: AstNode) =>
    resolveExpression(expression, constants, objectConstants, semanticVariables);
}

type ScopedBinding<T> = {
  variable: Variable;
  value: T;
  availableFrom: number;
};

type ScopeProgram = Parameters<typeof analyze>[0];
type SemanticVariableMap = WeakMap<object, Variable>;

function createSemanticVariableMap(program: AstNode): SemanticVariableMap {
  if (!isScopeProgram(program)) {
    throw new Error("Static resolver requires a ranged Program AST.");
  }

  const scopeManager = analyze(program, {
    childVisitorKeys: visitorKeys,
    lib: [],
    sourceType: "module"
  });
  const semanticVariables: SemanticVariableMap = new WeakMap();

  for (const scope of scopeManager.scopes) {
    for (const variable of scope.variables) {
      for (const identifier of variable.identifiers) {
        semanticVariables.set(identifier, variable);
      }

      for (const reference of variable.references) {
        semanticVariables.set(reference.identifier, variable);
      }
    }
  }

  return semanticVariables;
}

function isScopeProgram(program: AstNode): program is AstNode & ScopeProgram {
  return program.type === "Program" && Array.isArray(program.body) && Array.isArray(program.range);
}

function collectTypeAlias(
  node: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
): void {
  const variable = getSemanticVariable(node.id, semanticVariables);

  if (!variable || !isAstNode(node.typeAnnotation)) {
    return;
  }

  const resolvedObject = resolveObjectTypeAnnotation(
    node.typeAnnotation,
    objectConstants,
    typeAliases,
    objectTypeAliases,
    semanticVariables
  );

  if (resolvedObject) {
    objectTypeAliases.set(variable, resolvedObject);
    return;
  }

  const resolved = resolveTypeAnnotation(
    node.typeAnnotation,
    objectConstants,
    typeAliases,
    semanticVariables
  );

  if (resolved) {
    typeAliases.set(variable, resolved);
  }
}

function collectInterfaceDeclaration(
  node: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
): void {
  const variable = getSemanticVariable(node.id, semanticVariables);
  const resolved = resolveInterfaceDeclaration(
    node,
    objectConstants,
    typeAliases,
    objectTypeAliases,
    semanticVariables
  );

  if (variable && resolved) {
    objectTypeAliases.set(variable, resolved);
  }
}

function resolveInterfaceDeclaration(
  node: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
): Map<string, string[]> | undefined {
  const properties = new Map<string, string[]>();
  const heritageEntries = Array.isArray(node.extends) ? node.extends : [];

  for (const heritage of heritageEntries) {
    if (!isAstNode(heritage)) {
      continue;
    }

    const baseVariable = getSemanticVariable(heritage.expression, semanticVariables);
    const baseProperties = baseVariable ? objectTypeAliases.get(baseVariable) : undefined;

    if (baseProperties) {
      mergeObjectTypeProperties(properties, baseProperties);
    }
  }

  const ownProperties = isAstNode(node.body)
    ? resolveObjectTypeMembers(node.body.body, objectConstants, typeAliases, semanticVariables)
    : undefined;

  if (ownProperties) {
    mergeObjectTypeProperties(properties, ownProperties);
  }

  return properties.size > 0 ? properties : undefined;
}

function collectEnumDeclaration(
  node: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  semanticVariables: SemanticVariableMap
): void {
  const variable = getSemanticVariable(node.id, semanticVariables);
  const members = isAstNode(node.body) && Array.isArray(node.body.members) ? node.body.members : [];
  const enumValues = new Map<string, string[]>();

  if (!variable) {
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
    pushScopedBinding(objectConstants, variable, enumValues, node);
  }
}

function collectVariableDeclarator(
  node: AstNode,
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  semanticVariables: SemanticVariableMap
): void {
  const variable = getSemanticVariable(node.id, semanticVariables);

  if (!variable || !isStableVariable(variable) || !isAstNode(node.init)) {
    return;
  }

  const typedValues =
    isAstNode(node.id) && isAstNode(node.id.typeAnnotation)
      ? resolveTypeAnnotation(
          node.id.typeAnnotation,
          objectConstants,
          typeAliases,
          semanticVariables
        )
      : undefined;

  if (typedValues) {
    pushScopedBinding(constants, variable, typedValues, node);
    return;
  }

  const objectResolved = resolveObjectExpression(
    node.init,
    constants,
    objectConstants,
    semanticVariables
  );

  if (objectResolved) {
    pushScopedBinding(objectConstants, variable, objectResolved, node);
    return;
  }

  const resolved = resolveExpression(node.init, constants, objectConstants, semanticVariables);

  if (resolved) {
    pushScopedBinding(constants, variable, resolved, node);
  }
}

function collectForwardRefPropsBinding(
  node: AstNode,
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
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
    constants,
    objectConstants,
    typeAliases,
    objectTypeAliases,
    semanticVariables
  );
}

function collectTypedBinding(
  node: AstNode,
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
): void {
  const variable = getSemanticVariable(node, semanticVariables);

  if (variable && isAstNode(node.typeAnnotation)) {
    const resolved = resolveTypeAnnotation(
      node.typeAnnotation,
      objectConstants,
      typeAliases,
      semanticVariables
    );

    pushScopedBinding(constants, variable, resolved, node);
  }

  if (node.type !== "ObjectPattern" || !isAstNode(node.typeAnnotation)) {
    return;
  }

  collectObjectPatternTypedBindings(
    node,
    node.typeAnnotation,
    constants,
    objectConstants,
    typeAliases,
    objectTypeAliases,
    semanticVariables
  );
}

function collectObjectPatternTypedBindings(
  node: AstNode,
  annotation: AstNode,
  constants: ScopedBinding<string[] | undefined>[],
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
): void {
  const objectTypeProperties = getObjectTypeProperties(
    annotation,
    objectConstants,
    typeAliases,
    objectTypeAliases,
    semanticVariables
  );
  if (!objectTypeProperties) {
    for (const binding of collectObjectPatternBindings(node)) {
      const variable = getSemanticVariable(binding, semanticVariables);

      if (variable) {
        pushScopedBinding(constants, variable, undefined, binding);
      }
    }
    return;
  }

  const collectedVariables = new Set<Variable>();

  for (const [propertyName, propertyValues] of objectTypeProperties) {
    const binding = findObjectPatternBinding(node, propertyName);
    const variable = getSemanticVariable(binding, semanticVariables);

    if (variable && binding) {
      collectedVariables.add(variable);
      pushScopedBinding(constants, variable, propertyValues, binding);
    }
  }

  for (const binding of collectObjectPatternBindings(node)) {
    const variable = getSemanticVariable(binding, semanticVariables);

    if (variable && !collectedVariables.has(variable)) {
      pushScopedBinding(constants, variable, undefined, binding);
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
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  semanticVariables: SemanticVariableMap
): string[] | undefined {
  const literal = getStaticPrimitiveValue(expression);

  if (literal !== undefined) {
    return [literal];
  }

  if (expression.type === "TemplateLiteral") {
    return resolveTemplateLiteral(expression, constants, objectConstants, semanticVariables);
  }

  const identifier = getIdentifierName(expression);

  if (identifier) {
    return findVisibleBinding(constants, expression, semanticVariables)?.value;
  }

  if (expression.type === "MemberExpression") {
    const objectName = getIdentifierName(expression.object);
    const propertyName = getStaticPropertyName(expression.property);

    if (objectName && propertyName) {
      return isAstNode(expression.object)
        ? findVisibleBinding(objectConstants, expression.object, semanticVariables)?.value.get(
            propertyName
          )
        : undefined;
    }
  }

  if (expression.type === "ConditionalExpression") {
    const consequent = isAstNode(expression.consequent)
      ? resolveExpression(expression.consequent, constants, objectConstants, semanticVariables)
      : undefined;
    const alternate = isAstNode(expression.alternate)
      ? resolveExpression(expression.alternate, constants, objectConstants, semanticVariables)
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
    return resolveExpression(expression.expression, constants, objectConstants, semanticVariables);
  }

  return undefined;
}

function getObjectTypeProperties(
  annotation: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
): Map<string, string[]> | undefined {
  const typeNode = getTypeAnnotationBody(annotation);

  if (!typeNode) {
    return undefined;
  }

  if (typeNode.type === "TSTypeLiteral") {
    return resolveObjectTypeAnnotation(
      typeNode,
      objectConstants,
      typeAliases,
      objectTypeAliases,
      semanticVariables
    );
  }

  if (typeNode.type === "TSIntersectionType") {
    return resolveObjectTypeAnnotation(
      typeNode,
      objectConstants,
      typeAliases,
      objectTypeAliases,
      semanticVariables
    );
  }

  if (typeNode.type === "TSTypeReference") {
    const typeVariable = getSemanticVariable(typeNode.typeName, semanticVariables);
    return typeVariable ? objectTypeAliases.get(typeVariable) : undefined;
  }

  return undefined;
}

function resolveObjectTypeAnnotation(
  annotation: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  typeAliases: Map<Variable, string[]>,
  objectTypeAliases: Map<Variable, Map<string, string[]>>,
  semanticVariables: SemanticVariableMap
): Map<string, string[]> | undefined {
  const typeNode = getTypeAnnotationBody(annotation);

  if (!typeNode) {
    return undefined;
  }

  if (typeNode.type === "TSTypeLiteral") {
    return resolveObjectTypeMembers(
      typeNode.members,
      objectConstants,
      typeAliases,
      semanticVariables
    );
  }

  if (typeNode.type === "TSTypeReference") {
    const typeVariable = getSemanticVariable(typeNode.typeName, semanticVariables);
    return typeVariable ? objectTypeAliases.get(typeVariable) : undefined;
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
      objectTypeAliases,
      semanticVariables
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
  typeAliases: Map<Variable, string[]>,
  semanticVariables: SemanticVariableMap
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
      ? resolveTypeAnnotation(
          member.typeAnnotation,
          objectConstants,
          typeAliases,
          semanticVariables
        )
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
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  semanticVariables: SemanticVariableMap
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
      ? resolveExpression(property.value, constants, objectConstants, semanticVariables)
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
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  semanticVariables: SemanticVariableMap
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

    const resolved = resolveExpression(
      childExpression,
      constants,
      objectConstants,
      semanticVariables
    );

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
  typeAliases: Map<Variable, string[]>,
  semanticVariables: SemanticVariableMap
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

      const childValues = resolveTypeAnnotation(
        childType,
        objectConstants,
        typeAliases,
        semanticVariables
      );

      if (!childValues) {
        return undefined;
      }

      values.push(...childValues);
    }

    return values;
  }

  if (typeNode.type === "TSParenthesizedType") {
    return isAstNode(typeNode.typeAnnotation)
      ? resolveTypeAnnotation(
          typeNode.typeAnnotation,
          objectConstants,
          typeAliases,
          semanticVariables
        )
      : undefined;
  }

  if (typeNode.type === "TSTypeReference") {
    const typeVariable = getSemanticVariable(typeNode.typeName, semanticVariables);
    return typeVariable
      ? (typeAliases.get(typeVariable) ??
          resolveObjectConstantValues(
            isAstNode(typeNode.typeName)
              ? findVisibleBinding(objectConstants, typeNode.typeName, semanticVariables)?.value
              : undefined
          ))
      : undefined;
  }

  if (typeNode.type === "TSIndexedAccessType") {
    return resolveIndexedAccessType(typeNode, objectConstants, semanticVariables);
  }

  return undefined;
}

function resolveIndexedAccessType(
  typeNode: AstNode,
  objectConstants: ScopedBinding<Map<string, string[]>>[],
  semanticVariables: SemanticVariableMap
): string[] | undefined {
  const objectIdentifier = getTypeQueryIdentifier(typeNode.objectType);
  const objectName = getIdentifierName(objectIdentifier);

  if (!objectIdentifier || !objectName || !isKeyofTypeQuery(typeNode.indexType, objectName)) {
    return undefined;
  }

  const objectValues = findVisibleBinding(
    objectConstants,
    objectIdentifier,
    semanticVariables
  )?.value;

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
  return getIdentifierName(getTypeQueryIdentifier(node));
}

function getTypeQueryIdentifier(node: unknown): AstNode | undefined {
  if (!isAstNode(node)) {
    return undefined;
  }

  if (node.type === "TSParenthesizedType") {
    return getTypeQueryIdentifier(node.typeAnnotation);
  }

  return node.type === "TSTypeQuery" && isAstNode(node.exprName) ? node.exprName : undefined;
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

function pushScopedBinding<T>(
  bindings: ScopedBinding<T>[],
  variable: Variable,
  value: T,
  node: AstNode
): void {
  if (!isStableVariable(variable)) {
    return;
  }

  bindings.push({
    variable,
    value,
    availableFrom: node.end ?? node.start ?? 0
  });
}

function isStableVariable(variable: Variable): boolean {
  const writes = variable.references.filter((reference) => reference.isWrite());
  return writes.length <= 1 && writes.every((reference) => reference.init === true);
}

function getSemanticVariable(
  node: unknown,
  semanticVariables: SemanticVariableMap
): Variable | undefined {
  return isAstNode(node) ? semanticVariables.get(node) : undefined;
}

function findVisibleBinding<T>(
  bindings: ScopedBinding<T>[],
  expression: AstNode,
  semanticVariables: SemanticVariableMap
): ScopedBinding<T> | undefined {
  const variable = getSemanticVariable(expression, semanticVariables);
  const index = expression.start ?? 0;

  if (!variable || !isStableVariable(variable)) {
    return undefined;
  }

  return bindings
    .filter((binding) => binding.variable === variable && binding.availableFrom <= index)
    .sort((left, right) => right.availableFrom - left.availableFrom)[0];
}

function findObjectPatternBinding(pattern: AstNode, propertyName: string): AstNode | undefined {
  const properties = Array.isArray(pattern.properties) ? pattern.properties : [];

  for (const property of properties) {
    if (!isAstNode(property) || property.type !== "Property") {
      continue;
    }

    if (getStaticPropertyName(property.key) !== propertyName) {
      continue;
    }

    return getBinding(property.value);
  }

  return undefined;
}

function collectObjectPatternBindings(pattern: AstNode): AstNode[] {
  const properties = Array.isArray(pattern.properties) ? pattern.properties : [];

  return properties.flatMap((property) => {
    if (!isAstNode(property)) {
      return [];
    }

    if (property.type === "RestElement") {
      return collectBindings(property.argument);
    }

    if (property.type === "Property") {
      return collectBindings(property.value);
    }

    return [];
  });
}

function collectBindings(node: unknown): AstNode[] {
  if (isAstNode(node) && getIdentifierName(node)) {
    return [node];
  }

  if (!isAstNode(node)) {
    return [];
  }

  if (node.type === "AssignmentPattern") {
    return collectBindings(node.left);
  }

  if (node.type === "RestElement") {
    return collectBindings(node.argument);
  }

  if (node.type === "ObjectPattern") {
    return collectObjectPatternBindings(node);
  }

  if (node.type === "ArrayPattern") {
    const elements = Array.isArray(node.elements) ? node.elements : [];

    return elements.flatMap((element) => collectBindings(element));
  }

  return [];
}

function getBinding(node: unknown): AstNode | undefined {
  if (isAstNode(node) && getIdentifierName(node)) {
    return node;
  }

  if (isAstNode(node) && node.type === "AssignmentPattern") {
    return getBinding(node.left);
  }

  return undefined;
}
