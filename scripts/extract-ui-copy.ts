import ts from "typescript";
import fs from "node:fs";
const values = new Set<string>();
for (const name of ["App", "selling", "screens"]) {
  const text = fs.readFileSync(`apps/mobile/src/${name}.tsx`, "utf8");
  const source = ts.createSourceFile(
    name + ".tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function walk(node: ts.Node) {
    if (ts.isJsxText(node) && node.text.trim()) values.add(node.text.trim());
    if (
      ts.isJsxAttribute(node) &&
      [
        "label",
        "title",
        "detail",
        "placeholder",
        "accessibilityLabel",
      ].includes(node.name.getText(source)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      values.add(node.initializer.text);
    ts.forEachChild(node, walk);
  }
  walk(source);
}
console.log(JSON.stringify([...values].sort(), null, 2));
