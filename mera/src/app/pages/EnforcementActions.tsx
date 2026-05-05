import { Download, Search, Plus } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const actions = [
  { actionRef: 'ENF-1245', station: 'Shell Westlands', legalBasis: 'EPRA Act Sec 24(a)', actionType: 'Warning Notice', issuedBy: 'P. Kamau', issueDate: '2024-05-05', complianceDeadline: '2024-05-12', status: 'Active' },
  { actionRef: 'ENF-1244', station: 'Rubis Thika', legalBasis: 'EPRA Act Sec 26(b)', actionType: 'Operations Suspension', issuedBy: 'A. Njeri', issueDate: '2024-05-04', complianceDeadline: '2024-05-11', status: 'Pending Compliance' },
  { actionRef: 'ENF-1243', station: 'Hashi Ngong', legalBasis: 'EPRA Act Sec 24(a)', actionType: 'Penalty Notice', issuedBy: 'J. Mwangi', issueDate: '2024-05-03', complianceDeadline: '2024-05-10', status: 'Complied' },
  { actionRef: 'ENF-1242', station: 'Total Mombasa Rd', legalBasis: 'EPRA Act Sec 25(c)', actionType: 'Corrective Order', issuedBy: 'M. Otieno', issueDate: '2024-05-02', complianceDeadline: '2024-05-09', status: 'Active' },
  { actionRef: 'ENF-1241', station: 'Kenol Nakuru', legalBasis: 'EPRA Act Sec 24(a)', actionType: 'Warning Notice', issuedBy: 'P. Kamau', issueDate: '2024-05-01', complianceDeadline: '2024-05-08', status: 'Complied' },
];

const pendingSuspensions = [
  { station: 'Rubis Thika', reason: 'Hoarding violations', deadline: '2024-05-11', officer: 'A. Njeri' },
  { station: 'Hashi Langata', reason: 'Quality violations', deadline: '2024-05-13', officer: 'J. Mwangi' },
];

export function EnforcementActions() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <button className="bg-cyan-700 hover:bg-cyan-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-white">
          <Plus className="w-3 h-3" />
          Issue Action
        </button>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search actions..."
            className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300 flex-1"
          />
        </div>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Types</option>
          <option>Warning Notice</option>
          <option>Operations Suspension</option>
        </select>
        <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-slate-300">
          <Download className="w-3 h-3" />
          Export
        </button>
      </Toolbar>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-3">
          <div className="bg-slate-900 border border-slate-700 rounded">
            <div className="border-b border-slate-700 px-3 py-2">
              <h3 className="text-sm font-medium text-slate-200 uppercase">Enforcement Action Registry</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-400 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Action Ref</th>
                    <th className="px-2 py-1.5 text-left">Station</th>
                    <th className="px-2 py-1.5 text-left">Legal Basis</th>
                    <th className="px-2 py-1.5 text-left">Action Type</th>
                    <th className="px-2 py-1.5 text-left">Issued By</th>
                    <th className="px-2 py-1.5 text-left">Issue Date</th>
                    <th className="px-2 py-1.5 text-left">Compliance Deadline</th>
                    <th className="px-2 py-1.5 text-left">Current Status</th>
                    <th className="px-2 py-1.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {actions.map((action) => (
                    <tr key={action.actionRef} className="border-t border-slate-800 hover:bg-slate-800/50">
                      <td className="px-2 py-1.5 font-mono text-cyan-400">{action.actionRef}</td>
                      <td className="px-2 py-1.5 font-medium">{action.station}</td>
                      <td className="px-2 py-1.5 text-slate-400">{action.legalBasis}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          action.actionType === 'Operations Suspension' ? 'bg-red-900/30 border border-red-600 text-red-400' :
                          action.actionType === 'Penalty Notice' ? 'bg-orange-900/30 border border-orange-600 text-orange-400' :
                          'bg-amber-900/30 border border-amber-600 text-amber-400'
                        }`}>
                          {action.actionType}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">{action.issuedBy}</td>
                      <td className="px-2 py-1.5 text-slate-400">{action.issueDate}</td>
                      <td className="px-2 py-1.5 text-slate-400">{action.complianceDeadline}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          action.status === 'Complied' ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400' :
                          'bg-blue-900/30 border border-blue-600 text-blue-400'
                        }`}>
                          {action.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button className="text-cyan-400 hover:text-cyan-300 text-xs underline">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="w-72 bg-slate-900 border-l border-slate-700 overflow-y-auto p-3">
          <h3 className="text-sm font-medium text-slate-200 uppercase mb-3">Pending Suspensions Summary</h3>
          <div className="space-y-2">
            {pendingSuspensions.map((item, idx) => (
              <div key={idx} className="bg-red-900/20 border border-red-600 rounded p-2">
                <p className="text-xs font-medium text-slate-200 mb-1">{item.station}</p>
                <p className="text-xs text-slate-400 mb-1">{item.reason}</p>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Deadline:</span>
                  <span className="text-red-400 font-bold">{item.deadline}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">Officer: {item.officer}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
