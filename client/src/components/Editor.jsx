import Editor from "@monaco-editor/react";

export default function CodeEditor({ code, setCode }) {

  return (

    <Editor
      height="600px"
      language="javascript"
      value={code}
      onChange={(value) => setCode(value)}
    />

  );

}
