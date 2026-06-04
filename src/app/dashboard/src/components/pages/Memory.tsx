// src/components/pages/Memory.tsx
'use client'
import React, { useState, useEffect } from 'react'
import { 
  Database, Play, AlertTriangle, CheckCircle2, Table, 
  Terminal, ShieldAlert, Trash2, ArrowRight
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useSocket } from '../../hooks/useSocket'
import { useDashboardStore } from '../../store/dashboard'
import { cn } from '../../utils/cn'

interface MemoryProps {
  emit: (event: string, data?: any) => void
}

export default function Memory({ emit }: MemoryProps) {
  const { dbTables } = useDashboardStore()
  const { socket } = useSocket()
  
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM users LIMIT 10')
  const [isExecuting, setIsExecuting] = useState(false)
  const [queryResult, setQueryResult] = useState<{
    success: boolean
    isSelect?: boolean
    data?: any
    error?: string
  } | null>(null)

  // Listen for query responses
  useEffect(() => {
    if (!socket) return

    const handleResult = (res: any) => {
      setIsExecuting(false)
      setQueryResult(res)
      if (res.success) {
        toast.success('Query executed successfully')
      } else {
        toast.error('Query execution failed')
      }
    }

    socket.on('db:query_result', handleResult)
    return () => {
      socket.off('db:query_result', handleResult)
    }
  }, [socket])

  const handleExecuteQuery = (e: React.FormEvent) => {
    e.preventDefault()
    if (!sqlQuery.trim()) return

    setIsExecuting(true)
    setQueryResult(null)
    
    // Emit query event
    if (socket) {
      socket.emit('db:query', { sql: sqlQuery })
    } else {
      setIsExecuting(false)
      toast.error('Socket disconnected')
    }
  }

  const handleQuickTableQuery = (tableName: string) => {
    const query = `SELECT * FROM ${tableName} LIMIT 10`
    setSqlQuery(query)
    setIsExecuting(true)
    setQueryResult(null)
    if (socket) {
      socket.emit('db:query', { sql: query })
    }
  }

  const handleClearAllMemory = () => {
    if (confirm('Are you sure you want to purge all conversation context tables? This will delete all SQLite chat histories.')) {
      emit('memory:clear_all')
      toast.success('SQLite conversation context tables purged')
    }
  }

  // Helper to extract columns for dynamic tables
  const getTableColumnsAndRows = () => {
    if (!queryResult || !queryResult.success || !queryResult.isSelect || !Array.isArray(queryResult.data) || queryResult.data.length === 0) {
      return { columns: [], rows: [] }
    }
    const rows = queryResult.data
    const columns = Object.keys(rows[0])
    return { columns, rows }
  }

  const { columns, rows } = getTableColumnsAndRows()

  return (
    <div className="space-y-6 pb-10">
      {/* Header Panel */}
      <div className="flex justify-between items-center bg-surface/10 p-4 border border-border/80 rounded-xl glassmorphism">
        <div>
          <h3 className="text-sm font-semibold text-white font-mono flex items-center gap-2">
            <Database size={16} className="text-accent" />
            <span>SQLite Database Inspector</span>
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-sans">
            Directly execute read/write/drop queries and inspect active schemas in real-time.
          </p>
        </div>
        
        <button
          onClick={handleClearAllMemory}
          className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 hover:border-rose-500/30 text-rose-500 text-[10px] font-bold rounded-lg transition-colors font-mono"
        >
          <ShieldAlert size={12} />
          <span>Purge AI Contexts</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left column: Tables List */}
        <div className="p-4 bg-surface/10 border border-border/80 rounded-xl glassmorphism space-y-4 lg:col-span-1">
          <div className="flex items-center gap-2 text-xs font-bold text-white font-mono border-b border-border/60 pb-2">
            <Table size={14} className="text-accent" />
            <span>Database Tables ({dbTables.length})</span>
          </div>

          <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
            {dbTables.length === 0 ? (
              <p className="text-[10px] text-muted-foreground italic">No tables detected.</p>
            ) : (
              dbTables.map((tbl) => (
                <button
                  key={tbl}
                  onClick={() => handleQuickTableQuery(tbl)}
                  className="w-full text-left px-2.5 py-2 bg-muted/20 hover:bg-muted/40 border border-border/30 hover:border-accent/30 rounded-lg text-[10px] font-mono text-muted-foreground hover:text-white transition-all flex items-center justify-between group"
                >
                  <span className="truncate">{tbl}</span>
                  <ArrowRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity text-accent" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right column: SQL Console & Result Display */}
        <div className="lg:col-span-3 space-y-6">
          {/* Query console */}
          <form onSubmit={handleExecuteQuery} className="p-4 bg-surface/10 border border-border/80 rounded-xl glassmorphism space-y-4">
            <div className="flex items-center justify-between text-xs font-bold text-white font-mono border-b border-border/60 pb-2">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-accent" />
                <span>Interactive SQL Query Terminal</span>
              </div>
              <button
                type="submit"
                disabled={isExecuting}
                className={cn(
                  "px-3 py-1.5 bg-white hover:bg-neutral-200 disabled:bg-neutral-600 text-black text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1.5 shrink-0 shadow-lg",
                  isExecuting && "animate-pulse"
                )}
              >
                <Play size={10} fill="currentColor" />
                <span>{isExecuting ? 'Running...' : 'Run Query'}</span>
              </button>
            </div>

            <textarea
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              placeholder="e.g., SELECT * FROM users LIMIT 10"
              className="w-full h-24 p-3 bg-black/40 border border-border/80 rounded-lg text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-accent transition-colors font-mono resize-none leading-relaxed"
              required
            />
          </form>

          {/* Results Display */}
          {queryResult && (
            <div className="p-5 bg-surface/10 border border-border/80 rounded-xl glassmorphism space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-white font-mono border-b border-border/60 pb-2">
                <span>Query Execution Results</span>
                {queryResult.success ? (
                  <span className="flex items-center gap-1 text-[8px] font-sans text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                    <CheckCircle2 size={10} />
                    <span>SUCCESS</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[8px] font-sans text-rose-500 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded">
                    <AlertTriangle size={10} />
                    <span>FAILED</span>
                  </span>
                )}
              </div>

              {/* Error Output */}
              {!queryResult.success && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-lg flex items-start gap-2.5 text-xs text-rose-500 font-mono leading-relaxed">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>SQLite Error: {queryResult.error}</span>
                </div>
              )}

              {/* Success output */}
              {queryResult.success && (
                <div className="space-y-2">
                  {/* Select statement tabular output */}
                  {queryResult.isSelect ? (
                    rows.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/80 font-mono italic">Query executed successfully, but returned 0 rows.</p>
                    ) : (
                      <div className="overflow-x-auto border border-border/40 rounded-lg max-h-[300px]">
                        <table className="w-full text-left border-collapse font-mono text-[10px]">
                          <thead>
                            <tr className="bg-muted/40 border-b border-border/60 text-white font-bold">
                              {columns.map((col) => (
                                <th key={col} className="p-3 whitespace-nowrap">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20 text-muted-foreground">
                            {rows.map((row, rIdx) => (
                              <tr key={rIdx} className="hover:bg-muted/10 transition-colors">
                                {columns.map((col) => {
                                  const cellVal = row[col];
                                  const cellString = typeof cellVal === 'object' && cellVal !== null 
                                    ? JSON.stringify(cellVal) 
                                    : String(cellVal ?? 'NULL');
                                  return (
                                    <td key={col} className="p-3 truncate max-w-[200px]" title={cellString}>
                                      {cellString}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : (
                    /* DDL/DML statement count output */
                    <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-lg flex items-start gap-2.5 text-xs text-emerald-400 font-mono">
                      <CheckCircle2 size={16} className="shrink-0" />
                      <div>
                        <p>Query OK, changes executed successfully.</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Rows Affected: {queryResult.data?.changes ?? 0} | Last Row ID: {queryResult.data?.lastInsertRowid ?? 'N/A'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
