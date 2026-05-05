import { Search, Download, AlertTriangle } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const declarations = [
  { recordId: 'AVL-9847', station: 'Shell Westlands', district: 'Nairobi', petrol: 'Available', diesel: 'Partial', activePumps: '8/12', reportedBy: 'Station Manager', timestamp: '2024-05-05 09:15', complaintConflict: 'Yes', deliveryConflict: 'Yes', severity: 'High' },
  { recordId: 'AVL-9846', station: 'Total Mombasa Rd', district: 'Nairobi', petrol: 'Available', diesel: 'Dry', activePumps: '6/10', reportedBy: 'Attendant', timestamp: '2024-05-05 08:45', complaintConflict: 'No', deliveryConflict: 'No', severity: 'None' },
  { recordId: 'AVL-9845', station: 'Hashi Ngong', district: 'Nairobi', petrol: 'Partial', diesel: 'Available', activePumps: '10/14', reportedBy: 'Station Manager', timestamp: '2024-05-05 08:30', complaintConflict: 'Yes', deliveryConflict: 'No', severity: 'Medium' },
  { recordId: 'AVL-9844', station: 'Rubis Thika', district: 'Kiambu', petrol: 'Dry', diesel: 'Dry', activePumps: '0/8', reportedBy: 'Station Manager', timestamp: '2024-05-05 07:20', complaintConflict: 'No', deliveryConflict: 'Yes', severity: 'High' },
  { recordId: 'AVL-9843', station: 'Kenol Nakuru', district: 'Nakuru', petrol: 'Available', diesel: 'Available', activePumps: '12/12', reportedBy: 'Station Manager', timestamp: '2024-05-05 07:00', complaintConflict: 'No', deliveryConflict: 'No', severity: 'None' },
];

const suspicious = [
  { station: 'Shell Westlands', reason: 'Declared partial despite recent delivery', score: 94 },
  { station: 'Rubis Thika', reason: 'Dry declaration conflicts with delivery log', score: 88 },
  { station: 'Hashi Ngong', reason: 'Multiple complaint conflicts', score: 76 },
];

export function AvailabilityAudit() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search station..."
            className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300 flex-1"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" className="rounded" />
          Mismatch Only
        </label>
        <input type="date" className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300" />
        <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-slate-300">
          <Download className="w-3 h-3" />
          Export Declarations
        </button>
      </Toolbar>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-3">
          <div className="bg-slate-900 border border-slate-700 rounded">
            <div className="border-b border-slate-700 px-3 py-2">
              <h3 className="text-sm font-medium text-slate-200 uppercase">Station Declaration Audit Ledger</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-400 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Record ID</th>
                    <th className="px-2 py-1.5 text-left">Station</th>
                    <th className="px-2 py-1.5 text-left">District</th>
                    <th className="px-2 py-1.5 text-left">Petrol</th>
                    <th className="px-2 py-1.5 text-left">Diesel</th>
                    <th className="px-2 py-1.5 text-left">Active Pumps</th>
                    <th className="px-2 py-1.5 text-left">Reported By</th>
                    <th className="px-2 py-1.5 text-left">Timestamp</th>
                    <th className="px-2 py-1.5 text-center">Complaint Conflict</th>
                    <th className="px-2 py-1.5 text-center">Delivery Conflict</th>
                    <th className="px-2 py-1.5 text-left">Mismatch Severity</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {declarations.map((item) => (
                    <tr key={item.recordId} className={`border-t border-slate-800 hover:bg-slate-800/50 ${
                      item.severity === 'High' ? 'bg-red-900/10' : ''
                    }`}>
                      <td className="px-2 py-1.5 font-mono text-cyan-400">{item.recordId}</td>
                      <td className="px-2 py-1.5 font-medium">{item.station}</td>
                      <td className="px-2 py-1.5">{item.district}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          item.petrol === 'Available' ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400' :
                          item.petrol === 'Partial' ? 'bg-amber-900/30 border border-amber-600 text-amber-400' :
                          'bg-red-900/30 border border-red-600 text-red-400'
                        }`}>
                          {item.petrol}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          item.diesel === 'Available' ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400' :
                          item.diesel === 'Partial' ? 'bg-amber-900/30 border border-amber-600 text-amber-400' :
                          'bg-red-900/30 border border-red-600 text-red-400'
                        }`}>
                          {item.diesel}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono">{item.activePumps}</td>
                      <td className="px-2 py-1.5 text-slate-400">{item.reportedBy}</td>
                      <td className="px-2 py-1.5 text-slate-400">{item.timestamp}</td>
                      <td className="px-2 py-1.5 text-center">
                        {item.complaintConflict === 'Yes' && <AlertTriangle className="w-3 h-3 text-red-400 inline" />}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {item.deliveryConflict === 'Yes' && <AlertTriangle className="w-3 h-3 text-red-400 inline" />}
                      </td>
                      <td className="px-2 py-1.5">
                        {item.severity !== 'None' && (
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            item.severity === 'High' ? 'bg-red-900/30 border border-red-600 text-red-400' :
                            'bg-amber-900/30 border border-amber-600 text-amber-400'
                          }`}>
                            {item.severity}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="w-64 bg-slate-900 border-l border-slate-700 overflow-y-auto p-3">
          <h3 className="text-sm font-medium text-slate-200 uppercase mb-3">Most Suspicious Declarations</h3>
          <div className="space-y-2">
            {suspicious.map((item, idx) => (
              <div key={idx} className="bg-red-900/20 border border-red-600 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-slate-200">{item.station}</p>
                  <span className="text-xs font-bold text-red-400">{item.score}</span>
                </div>
                <p className="text-xs text-slate-400">{item.reason}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
