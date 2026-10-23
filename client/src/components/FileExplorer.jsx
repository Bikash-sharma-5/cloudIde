import { useEffect, useState } from "react";
import { getFiles, readFile } from "../services/api";

export default function FileExplorer({ roomId, userId, openFile }) {

  const [files, setFiles] = useState([]);

  useEffect(() => {
    loadFiles();
  }, [roomId, userId]);

  const loadFiles = async () => {

    try {

      const res = await getFiles(roomId, userId);

      console.log("FILES:", res.data);

      setFiles(Array.isArray(res.data) ? res.data : []);

    } catch (err) {

      console.error(err);

    }

  };

  const handleOpenFile = async (file) => {

    try {

      const res = await readFile(roomId, userId, file);

      openFile(file, res.data.content);

    } catch (err) {

      console.error(err);

    }

  };

  return (

    <div style={{ width: "250px", borderRight: "1px solid #ccc" }}>

      <h3>Files</h3>

      {files.length === 0 && <p>No files found</p>}

      {files.map((file, i) => (

        <div
          key={i}
          onClick={() => handleOpenFile(file)}
          style={{
            cursor: "pointer",
            padding: "5px"
          }}
        >
          {file}
        </div>

      ))}

    </div>

  );

}
