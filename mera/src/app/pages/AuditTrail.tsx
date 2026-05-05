import { Download, Search } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const auditLogs = [
  { logRef: 'LOG-28471', officer: 'Peter Kamau', role: 'Senior Inspector', actionType: 'Inspection Logged', affectedCase: 'INS-4521 / Shell Westlands', timestamp: '2024-05-05 10:15:32', ip: '192.168.1.45', notes: 'Field inspection completed, violation found' },
  { logRef: 'LOG-28470', officer: 'Jane Mwangi', role: 'Field Officer', actionType: 'Complaint Assigned', affectedCase: 'CMP-7841 / Hashi Ngong', timestamp: '2024-05-05 09:47:18', ip: '192.168.1.52', notes: 'High priority hoarding complaint assigned for investigation' },
  { logRef: 'LOG-28469', officer: 'Michael Otieno', role: 'Compliance Officer', actionType: 'Enforcement Action Issued', affectedCase: 'ENF-1242 / Total Mombasa Rd', timestamp: '2024-05-05 09:23:45', ip: '192.168.1.38', notes: 'Corrective order issued for price violation' },
  { logRef: 'LOG-28468', officer: 'Anne Njeri', role: 'Field Officer', actionType: 'Evidence Uploaded', affectedCase: 'INS-4518 / Rubis Thika', timestamp: '2024-05-04 16:25:12', ip: '192.168.1.67', notes: 'Geotagged photos uploaded from field inspection' },
  { logRef: 'LOG-28467', officer: 'Peter Kamau', role: 'Senior Inspector', actionType: 'Flag Reviewed', affectedCase: 'FLG-3421 / Shell Westlands', timestamp: '2024-05-04 15:48:33', ip: '192.168.1.45', notes: 'Delivery-declaration mismatch flag under review' },
  { logRef: 'LOG-28466', officer: 'Jane Mwangi', role: 'Field Officer', actionType: 'Delivery Verified', affectedCase: 'DLV-5846 / Total Mombasa Rd', timestamp: '2024-05-04 14:32:19', ip: '192.168.1.52', notes: 'Tanker delivery verified against manifest' },
  { logRef: 'LOG-28465', officer: 'Michael Otieno', role: 'Compliance Officer', actionType: 'Station Profile Updated', affectedCase: 'Shell Westlands', timestamp: '2024-05-04 13:15:47', ip: '192.168.1.38', notes: 'Risk score updated to 94 based on recent activity' },
  { logRef: 'LOG-28464', officer: 'Anne Njeri', role: 'Field Officer', actionType: 'Complaint Resolved', affectedCase: 'CMP-7840 / Total Mombasa Rd', timestamp: '2024-05-04 11:58:22', ip: '192.168.1.67', notes: 'Price violation complaint resolved after corrective action' },
];

export function AuditTrail() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search audit logs..."
            className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300 flex-1"
          />
        </div>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Officers</option>
          <option>P. Kamau</option>
          <option>J. Mwangi</option>
        </select>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Actions</option>
          <option>Inspection Logged</option>
          <option>Enforcement Action Issued</option>
          <option>Evidence Uploaded</option>
        </select>
        <input type="date" className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300" />
        <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-slate-300">
          <Download className="w-3 h-3" />
          Export
        </button>
      </Toolbar>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="bg-slate-900 border border-slate-700 rounded">
          <div className="border-b border-slate-700 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-200 uppercase">System Audit Trail (Chronological)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="px-2 py-1.5 text-left">Log Ref</th>
                  <th className="px-2 py-1.5 text-left">Officer</th>
                  <th className="px-2 py-1.5 text-left">Role</th>
                  <th className="px-2 py-1.5 text-left">Action Type</th>
                  <th className="px-2 py-1.5 text-left">Affected Station/Case</th>
                  <th className="px-2 py-1.5 text-left">Timestamp</th>
                  <th className="px-2 py-1.5 text-left">IP/Device</th>
                  <th className="px-2 py-1.5 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {auditLogs.map((log) => (
                  <tr key={log.logRef} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-2 py-1.5 font-mono text-cyan-400">{log.logRef}</td>
                    <td className="px-2 py-1.5 font-medium">{log.officer}</td>
                    <td className="px-2 py-1.5 text-slate-400">{log.role}</td>
                    <td className="px-2 py-1.5">
                      <span className="px-2 py-0.5 bg-blue-900/30 border border-blue-600 rounded text-blue-400 text-xs">
                        {log.actionType}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{log.affectedCase}</td>
                    <td className="px-2 py-1.5 text-slate-400 font-mono">{log.timestamp}</td>
                    <td className="px-2 py-1.5 text-slate-400 font-mono">{log.ip}</td>
                    <td className="px-2 py-1.5 text-slate-400 max-w-xs truncate">{log.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
