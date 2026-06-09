import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Table2, Download, Plus, Trash2 } from 'lucide-react';

interface CsvData {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

interface CsvEditorProps {
  filePath: string;
}

export default function CsvEditor({ filePath }: CsvEditorProps) {
  const [data, setData] = useState<CsvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCsv();
  }, [filePath]);

  const loadCsv = async () => {
    try {
      setLoading(true);
      const result: CsvData = await invoke('read_csv', { path: filePath });
      setData(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    if (!data) return;
    const newRows = [...data.rows];
    newRows[rowIndex][colIndex] = value;
    setData({ ...data, rows: newRows });
  };

  const handleHeaderChange = (colIndex: number, value: string) => {
    if (!data) return;
    const newHeaders = [...data.headers];
    newHeaders[colIndex] = value;
    setData({ ...data, headers: newHeaders });
  };

  const addRow = () => {
    if (!data) return;
    const newRow = new Array(data.headers.length).fill('');
    setData({ ...data, rows: [...data.rows, newRow] });
  };

  const addColumn = () => {
    if (!data) return;
    const newHeaders = [...data.headers, `Column ${data.headers.length + 1}`];
    const newRows = data.rows.map(row => [...row, '']);
    setData({ ...data, headers: newHeaders, rows: newRows });
  };

  const deleteRow = (index: number) => {
    if (!data) return;
    const newRows = data.rows.filter((_, i) => i !== index);
    setData({ ...data, rows: newRows });
  };

  const saveCsv = async () => {
    if (!data) return;
    try {
      await invoke('write_csv', { 
        path: filePath, 
        headers: data.headers, 
        rows: data.rows, 
        delimiter: data.delimiter 
      });
      alert('CSV saved successfully!');
    } catch (err) {
      alert(`Error saving CSV: ${err}`);
    }
  };

  if (loading) return <div className="p-8 text-zinc-400">Loading CSV...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e] text-zinc-900 dark:text-zinc-100 overflow-hidden">
      <div className="flex items-center gap-2 p-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
        <button onClick={saveCsv} className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
          <Download size={14} /> Save CSV
        </button>
        <button onClick={addRow} className="flex items-center gap-1 px-3 py-1 text-xs bg-zinc-200 dark:bg-zinc-800 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700">
          <Plus size={14} /> Add Row
        </button>
        <button onClick={addColumn} className="flex items-center gap-1 px-3 py-1 text-xs bg-zinc-200 dark:bg-zinc-800 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700">
          <Table2 size={14} /> Add Column
        </button>
      </div>
      
      <div className="flex-1 overflow-auto p-4">
        <table className="w-max min-w-full border-collapse">
          <thead>
            <tr>
              <th className="border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-1 w-10"></th>
              {data.headers.map((header, i) => (
                <th key={i} className="border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-0">
                  <input 
                    className="w-full bg-transparent p-2 outline-none text-sm font-semibold"
                    value={header}
                    onChange={(e) => handleHeaderChange(i, e.target.value)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="border border-zinc-300 dark:border-zinc-700 p-1 text-center">
                  <button onClick={() => deleteRow(rowIndex)} className="text-red-500 hover:text-red-600 p-1">
                    <Trash2 size={14} />
                  </button>
                </td>
                {row.map((cell, colIndex) => (
                  <td key={colIndex} className="border border-zinc-300 dark:border-zinc-700 p-0">
                    <input 
                      className="w-full bg-transparent p-2 outline-none text-sm focus:bg-blue-50 dark:focus:bg-blue-900/20"
                      value={cell}
                      onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
