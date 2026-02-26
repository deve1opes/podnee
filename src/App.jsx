import React, { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { 
  PlusCircle, Trash2, Calculator, DollarSign, 
  Calendar, TrendingDown, Download, 
  Printer, Cloud, User, AlertCircle,
  ChevronDown, ChevronUp, BookOpen, Edit, LogOut
} from 'lucide-react';
import { initializeApp } from "firebase/app";
import { 
  getAuth, signInAnonymously, signInWithCustomToken,
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut 
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// --- Firebase Initialization (Safe Init for all environments) ---
let app, auth, db;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    const firebaseConfig = JSON.parse(__firebase_config);
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
} catch (e) {
  console.error("Firebase config is invalid or missing.", e);
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [userName, setUserName] = useState(localStorage.getItem('debt_planner_username') || '');
  const [isGoogleLogin, setIsGoogleLogin] = useState(localStorage.getItem('debt_planner_login_type') === 'google');
  const [isNamePromptOpen, setIsNamePromptOpen] = useState(!localStorage.getItem('debt_planner_username') && !isGoogleLogin);
  const [saveStatus, setSaveStatus] = useState('idle'); 
  
  const [budget, setBudget] = useState(16000);
  const [minPercent, setMinPercent] = useState(5);
  const [debts, setDebts] = useState([
    { id: 1, name: 'หนี้ A', balance: 10000, rate: 25, minPay: '' },
    { id: 2, name: 'หนี้ B', balance: 20000, rate: 18, minPay: '' },
    { id: 3, name: 'หนี้ C', balance: 30000, rate: 33, minPay: '' }
  ]);

  const [report, setReport] = useState(null);
  const [baseReport, setBaseReport] = useState(null); 
  const [errorMessage, setErrorMessage] = useState(null);
  const [isEditingTable, setIsEditingTable] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [showAvalancheInfo, setShowAvalancheInfo] = useState(false);

  // --- SEO Optimization ---
  useEffect(() => {
    document.title = "Debt Avalanche Planner | วางแผนปลดหนี้อัจฉริยะ";

    const setMetaTag = (attrName, attrValue, content) => {
      let element = document.querySelector(`meta[${attrName}="${attrValue}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attrName, attrValue);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    setMetaTag('name', 'description', 'แอปพลิเคชันวางแผนปลดหนี้ด้วยวิธี Debt Avalanche คำนวณดอกเบี้ย วางแผนผ่อนชำระ และช่วยประหยัดดอกเบี้ยให้คุณได้มากที่สุด');
    setMetaTag('name', 'keywords', 'วางแผนปลดหนี้, จัดการหนี้, คำนวณหนี้, Debt Avalanche, ลดต้นลดดอก, หนี้บัตรเครดิต, อิสรภาพทางการเงิน');
    setMetaTag('name', 'author', 'Debt Avalanche Planner');
    setMetaTag('property', 'og:title', 'Debt Avalanche Planner | วางแผนปลดหนี้อัจฉริยะ');
    setMetaTag('property', 'og:description', 'คำนวณและวางแผนปิดหนี้ให้ไวที่สุด ประหยัดดอกเบี้ยที่สุดด้วยกลยุทธ์ Debt Avalanche ใช้งานฟรี!');
    setMetaTag('property', 'og:type', 'website');
    setMetaTag('name', 'twitter:card', 'summary');
    setMetaTag('name', 'twitter:title', 'Debt Avalanche Planner');
    setMetaTag('name', 'twitter:description', 'แอปพลิเคชันคำนวณแผนปิดหนี้ด้วยวิธี Debt Avalanche ประหยัดดอกเบี้ยให้ได้มากที่สุด');
  }, []);

  const getSuggestions = useCallback((balance) => {
    const bal = parseFloat(balance) || 0;
    if (bal <= 0) return { calcMin: 0 };
    let calcMin = bal * ((parseFloat(minPercent) || 0) / 100);
    if (calcMin < 500) calcMin = 500;
    if (bal < 500) calcMin = bal;
    return { calcMin };
  }, [minPercent]);

  const loadUserData = useCallback(async (identifier, isGoogle = false) => {
    if (!identifier || !db) return false;
    try {
      const docPath = isGoogle 
        ? doc(db, 'artifacts', appId, 'users', identifier, 'debtPlanner', 'mainData')
        : doc(db, 'artifacts', appId, 'public', 'data', 'userProfiles', identifier.trim().toLowerCase());
      
      const docSnap = await getDoc(docPath);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.budget !== undefined) setBudget(Number(data.budget));
        if (data.minPercent !== undefined) setMinPercent(Number(data.minPercent));
        if (data.debts) setDebts(data.debts);
        return true;
      }
    } catch (err) {
      console.error("Load error:", err);
    }
    return false;
  }, []);

  const generateReport = useCallback((currentOverrides = overrides) => {
    let parsedDebts = debts.map(d => {
      let bal = parseFloat(d.balance) || 0;
      let rate = parseFloat(d.rate) || 0;
      let { calcMin } = getSuggestions(bal);
      let min = parseFloat(d.minPay) || calcMin;
      return { ...d, bal, rate, min, pay: 0 };
    }).filter(d => d.bal > 0);

    if (parsedDebts.length === 0) return null;

    let baseBgt = parseFloat(budget) || 0;
    let sortedDebts = [...parsedDebts].sort((a, b) => b.rate - a.rate);
    let reportRows = [];
    let totalInterest = 0;
    let month = 0;
    let remainBal = sortedDebts.reduce((sum, d) => sum + d.bal, 0);

    while (remainBal > 0.01 && month < 600) {
      month++;
      let currentMonthOverride = currentOverrides[month] || {};
      let currentMonthBudget = currentMonthOverride.total !== undefined ? currentMonthOverride.total : baseBgt;
      let extra = currentMonthBudget;
      let actualPaidThisMonth = 0;

      sortedDebts.forEach(d => {
        let int = d.bal * (d.rate / 100 / 12);
        d.bal += int;
        totalInterest += int;
        d.pay = 0;
      });

      sortedDebts.forEach(d => {
        if (d.bal > 0 && currentMonthOverride.debts?.[d.id] !== undefined) {
          let manualPay = Math.min(currentMonthOverride.debts[d.id], extra, d.bal);
          d.pay += manualPay; d.bal -= manualPay; extra -= manualPay; actualPaidThisMonth += manualPay;
          d.isManual = true;
        } else d.isManual = false;
      });

      sortedDebts.forEach(d => {
        if (d.bal > 0 && !d.isManual) {
          let pay = Math.min(d.min, d.bal, extra);
          d.pay += pay; d.bal -= pay; extra -= pay; actualPaidThisMonth += pay;
        }
      });

      if (extra > 0.01) {
        for (let d of sortedDebts) {
          if (d.bal > 0 && !d.isManual) {
            let pay = Math.min(d.bal, extra);
            d.pay += pay; d.bal -= pay; extra -= pay; actualPaidThisMonth += pay;
            if (extra <= 0.01) break;
          }
        }
      }

      let rowData = { month, totalBal: 0, totalPaid: actualPaidThisMonth, debtsState: {} };
      sortedDebts.forEach(d => {
        if (d.bal < 0) d.bal = 0;
        rowData.totalBal += d.bal;
        rowData.debtsState[d.id] = { pay: d.pay, bal: d.bal };
      });
      reportRows.push(rowData);
      remainBal = rowData.totalBal;
    }
    return { totalMonths: month, totalInterest, rows: reportRows, originalCols: parsedDebts };
  }, [debts, budget, overrides, getSuggestions]);

  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else if (localStorage.getItem('debt_planner_login_type') !== 'google') {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth init failed", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (user && !user.isAnonymous) {
        setIsGoogleLogin(true);
        setUserName(user.displayName || 'ผู้ใช้ Google');
        localStorage.setItem('debt_planner_login_type', 'google');
        setIsNamePromptOpen(false);
        await loadUserData(user.uid, true);
      }
    });
    return () => unsubscribe();
  }, [loadUserData]);

  const saveUserData = useCallback(async () => {
    if (!authUser || isNamePromptOpen || !db) return;
    setSaveStatus('saving');
    try {
      const docPath = (isGoogleLogin && !authUser.isAnonymous)
        ? doc(db, 'artifacts', appId, 'users', authUser.uid, 'debtPlanner', 'mainData')
        : doc(db, 'artifacts', appId, 'public', 'data', 'userProfiles', userName.trim().toLowerCase());

      await setDoc(docPath, {
        budget, minPercent, debts, updatedAt: new Date().toISOString()
      }, { merge: true });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error("Save error:", err);
      setSaveStatus('idle');
    }
  }, [authUser, userName, budget, minPercent, debts, isNamePromptOpen, isGoogleLogin]);

  const saveTimer = useRef(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveUserData, 2000);
    return () => clearTimeout(saveTimer.current);
  }, [budget, minPercent, debts, saveUserData]);

  const handleGoogleLogin = async () => {
    if(!auth) return setErrorMessage('❌ ไม่สามารถเชื่อมต่อฐานข้อมูลได้\n\nสาเหตุที่พบบ่อย (หากใช้งานบน Vercel):\n1. ยังไม่ได้ตั้งค่า VITE_FIREBASE_CONFIG\n2. ตั้งค่าแล้วแต่ยังไม่ได้กด "Redeploy"\n3. รูปแบบโค้ด JSON ไม่ถูกต้อง');
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      setErrorMessage(`ไม่สามารถเข้าสู่ระบบด้วย Google ได้: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      if(auth) await signOut(auth);
      setIsGoogleLogin(false);
      setUserName('');
      localStorage.removeItem('debt_planner_username');
      localStorage.removeItem('debt_planner_login_type');
      setIsNamePromptOpen(true);
      if(auth) await signInAnonymously(auth);
    } catch (error) {
      console.error(error);
    }
  };

  const handleNameSubmit = async (e) => {
    e.preventDefault();
    const nameInput = e.target.username.value.trim();
    if (!nameInput) return;
    await loadUserData(nameInput, false);
    setUserName(nameInput);
    localStorage.setItem('debt_planner_username', nameInput);
    localStorage.setItem('debt_planner_login_type', 'anonymous');
    setIsNamePromptOpen(false);
  };

  const handleCalculate = () => {
    const res = generateReport({});
    if (!res) {
      setErrorMessage("กรุณาระบุยอดหนี้ที่มากกว่า 0");
      return;
    }
    setBaseReport(res);
    setReport(res);
    setOverrides({});
  };

  const handleAddDebt = () => {
    const newId = debts.length > 0 ? Math.max(...debts.map(d => d.id)) + 1 : 1;
    setDebts([...debts, { id: newId, name: '', balance: '', rate: '', minPay: '' }]);
  };

  const handleRemoveDebt = (id) => {
    setDebts(prev => prev.filter(d => d.id !== id));
  };

  const handleChange = (id, field, value) => {
    setDebts(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  const getOverrideReason = () => {
    const keys = Object.keys(overrides);
    if (keys.length === 0) return null;
    const sortedKeys = keys.map(Number).sort((a, b) => a - b);
    if (keys.length > 3) return `ระยะเวลาปลดหนี้/ดอกเบี้ยรวมเปลี่ยนแปลงเนื่องจากมีการปรับแต่งข้อมูลด้วยตนเองรวม ${keys.length} เดือน`;
    let reasonParts = [];
    sortedKeys.forEach(m => {
      let part = `เดือนที่ ${m}`;
      if (overrides[m].total !== undefined) part += " (แก้ไขยอดจ่ายรวม)";
      if (overrides[m].debts) part += " (แก้ไขยอดโอนรายก้อน)";
      reasonParts.push(part);
    });
    return `ระยะเวลาปลดหนี้/ดอกเบี้ยรวมเปลี่ยนแปลงเนื่องจากมีการแก้ไขข้อมูลใน: ${reasonParts.join(', ')}`;
  };

  const formatMoney = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  
  const isModified = Object.keys(overrides).length > 0;
  const diffMonths = baseReport && report ? report.totalMonths - baseReport.totalMonths : 0;
  const diffInt = baseReport && report ? report.totalInterest - baseReport.totalInterest : 0;
  const hasChange = diffMonths !== 0 || diffInt !== 0;

  // --- Dynamic Print Style ---
  const getPrintStyle = () => {
    if (!report) return "";
    const count = report.originalCols.length;
    const isLandscape = count >= 2; // บังคับแนวนอนถ้ามีหนี้ตั้งแต่ 2 ก้อนขึ้นไป
    let fontSize = count > 5 ? "6pt" : count > 3 ? "7pt" : "8pt";
    
    return `
      @media print { 
        @page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; margin: 1cm; }
        body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        table { font-size: ${fontSize} !important; width: 100% !important; page-break-inside: auto; }
        tr { page-break-inside: avoid; page-break-after: auto; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
      }
    `;
  };

  const exportToCSV = () => {
    if (!report) return;
    let csvContent = "\uFEFFเดือนที่,หนี้คงเหลือรวม,จ่ายรวมเดือนนี้";
    report.originalCols.forEach(col => { csvContent += `,${col.name} (โอนจ่าย),${col.name} (ยอดเหลือ)`; });
    csvContent += '\n';
    report.rows.forEach((row) => {
      let rowData = [row.month, row.totalBal.toFixed(2), row.totalPaid.toFixed(2)];
      report.originalCols.forEach(col => {
        const state = row.debtsState[col.id];
        rowData.push(state.pay.toFixed(2));
        rowData.push(state.bal.toFixed(2));
      });
      csvContent += rowData.join(',') + '\n';
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `debt_plan_${userName || 'export'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen text-slate-800 p-4 md:p-8 print:bg-white print:p-0">
      <style>{getPrintStyle()}</style>

      {isNamePromptOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 print:hidden">
          <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full space-y-6 text-center border border-slate-100">
            <div className="mx-auto w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center"><User size={32} /></div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-slate-900">ยินดีต้อนรับ</h2>
              <p className="text-slate-500 text-sm">เข้าสู่ระบบเพื่อบันทึกและซิงค์แผนปลดหนี้ของคุณข้ามอุปกรณ์</p>
            </div>
            
            <button onClick={handleGoogleLogin} className="w-full py-3.5 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-50 shadow-sm transition-all">
              <span className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-full text-[10px] font-black italic">G</span> เข้าสู่ระบบด้วย Google
            </button>
            
            <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase py-2"><hr className="flex-1"/> หรือใช้งานทั่วไป <hr className="flex-1"/></div>
            
            <form onSubmit={handleNameSubmit} className="space-y-4">
              <input name="username" type="text" required placeholder="ระบุชื่อเรียกของคุณ..." className="w-full p-4 border-2 border-slate-100 rounded-2xl outline-none focus:border-emerald-500 bg-slate-50/50" />
              <button type="submit" className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-black shadow-lg">เริ่มต้นใช้งาน</button>
            </form>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl border border-rose-100">
            <AlertCircle className="text-rose-500 mx-auto w-12 h-12" />
            <p className="text-slate-600 font-medium leading-relaxed whitespace-pre-line">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="w-full py-2 bg-slate-800 text-white rounded-lg">ตกลง</button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center px-2 print:hidden">
          <div className="bg-white px-4 py-2 rounded-full border border-slate-200 flex items-center gap-2 shadow-sm">
            <User size={16} className="text-emerald-500" />
            <span className="font-bold text-slate-700">{userName}</span>
            {isGoogleLogin ? (
              <button onClick={handleLogout} className="text-xs text-rose-500 ml-2 flex items-center gap-1 hover:underline"><LogOut size={14}/> ออกจากระบบ</button>
            ) : (
              <button onClick={() => setIsNamePromptOpen(true)} className="text-xs text-blue-500 ml-2 hover:underline">(สลับบัญชี)</button>
            )}
          </div>
          <div className="flex gap-2 items-center">
            {saveStatus === 'saving' && <span className="text-xs text-amber-500 animate-pulse font-medium">กำลังบันทึก...</span>}
            {saveStatus === 'saved' && <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium"><Cloud size={16}/> บันทึกแล้ว</span>}
            {!db && <span className="text-xs text-slate-400 font-medium">Offline Mode</span>}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:hidden">
          <button onClick={() => setShowAvalancheInfo(!showAvalancheInfo)} className="w-full p-4 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition">
            <div className="flex items-center gap-3 font-bold text-slate-700"><BookOpen className="text-emerald-500"/> หลักการทำงานของวิธี Debt Avalanche</div>
            {showAvalancheInfo ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
          </button>
          {showAvalancheInfo && (
            <div className="p-6 border-t text-sm text-slate-600 space-y-3 leading-relaxed">
              <p><strong>Debt Avalanche:</strong> คือกลยุทธ์การปลดหนี้ที่เน้น <strong>"ประหยัดดอกเบี้ยให้ได้มากที่สุด"</strong> โดยเน้นชำระหนี้ก้อนที่มีอัตราดอกเบี้ยสูงที่สุดก่อน</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>จ่ายขั้นต่ำทุกก้อนเสมอเพื่อรักษาเครดิตบูโร</li>
                <li>เงินที่เหลือจากงบประมาณ (Extra) ทั้งหมดให้นำไปโปะก้อนที่มียอด <strong>"ดอกเบี้ย % สูงสุด"</strong></li>
                <li>เมื่อก้อนนั้นหมด ให้นำเงินที่เคยจ่ายทั้งหมดไปทบก้อนถัดไปทันทีเพื่อให้เกิดแรงส่ง</li>
              </ul>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col md:flex-row gap-6 items-center print:hidden">
           <div className="flex-1">
             <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2"><TrendingDown className="text-emerald-500"/> Debt Avalanche Planner</h1>
             <p className="text-slate-500 text-sm">วางแผนปลดหนี้ที่คุ้มค่าที่สุดในเชิงคณิตศาสตร์การเงิน</p>
           </div>
           <div className="bg-emerald-50 p-4 rounded-xl flex gap-4 border border-emerald-100">
             <div>
               <label className="text-xs font-bold text-emerald-800 block mb-1">งบชำระ/เดือน</label>
               <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className="w-28 p-2 rounded-lg border-slate-200 outline-none font-bold text-center bg-white shadow-inner" />
             </div>
             <div>
               <label className="text-xs font-bold text-emerald-800 block mb-1">ขั้นต่ำ (%)</label>
               <input type="number" value={minPercent} onChange={(e) => setMinPercent(e.target.value)} className="w-16 p-2 rounded-lg border-slate-200 outline-none font-bold text-center bg-white shadow-inner" />
             </div>
           </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:hidden">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50/50">
            <h2 className="font-bold text-slate-700">รายการหนี้สิน</h2>
            <button onClick={handleAddDebt} className="text-xs font-bold px-4 py-2 bg-white border border-slate-200 rounded-xl flex items-center gap-2 shadow-sm hover:bg-slate-50 transition"><PlusCircle size={16} className="text-emerald-500"/> เพิ่มรายการ</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest">
                <tr>
                  <th className="p-4">ชื่อหนี้</th>
                  <th className="p-4">ยอดเงินต้น</th>
                  <th className="p-4">ดอกเบี้ย/ปี (%)</th>
                  <th className="p-4">ยอดจ่ายขั้นต่ำ</th>
                  <th className="p-4 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {debts.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50/30 transition-colors">
                    <td className="p-2 min-w-[120px]"><input type="text" value={d.name} onChange={(e) => handleChange(d.id, 'name', e.target.value)} className="w-full p-2 border border-slate-100 rounded-lg text-sm bg-white shadow-inner" /></td>
                    <td className="p-2 min-w-[100px]"><input type="number" value={d.balance} onChange={(e) => handleChange(d.id, 'balance', e.target.value)} className="w-full p-2 border border-slate-100 rounded-lg text-sm font-bold bg-white shadow-inner" /></td>
                    <td className="p-2 min-w-[80px]"><input type="number" value={d.rate} onChange={(e) => handleChange(d.id, 'rate', e.target.value)} className="w-full p-2 border border-slate-100 rounded-lg text-sm font-bold bg-white shadow-inner" /></td>
                    <td className="p-2 min-w-[100px]"><input type="number" value={d.minPay} onChange={(e) => handleChange(d.id, 'minPay', e.target.value)} placeholder={getSuggestions(d.balance).calcMin.toFixed(0)} className="w-full p-2 border border-slate-100 rounded-lg text-sm bg-white shadow-inner" /></td>
                    <td className="p-2 text-center"><button onClick={() => handleRemoveDebt(d.id)} className="text-slate-300 hover:text-rose-500 p-2 transition"><Trash2 size={18}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={handleCalculate} className="w-full py-5 bg-slate-900 text-white font-black text-lg hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg"><Calculator size={22}/> คำนวณแผนปลดหนี้</button>
        </div>

        {report && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start gap-4 print:hidden">
              <button onClick={() => setIsEditingTable(!isEditingTable)} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold border transition-all shadow-sm ${isEditingTable ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}><Edit size={18}/> {isEditingTable ? "บันทึกและปิดโหมดแก้ไข" : "แก้ไขตารางจำลองหนี้"}</button>
              <div className="flex gap-2">
              <button onClick={() => window.print()} className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl flex items-center gap-2 shadow-sm font-bold hover:bg-slate-50"><Printer size={18}/> พิมพ์ PDF</button>
              <button onClick={exportToCSV} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl flex items-center gap-2 shadow-sm font-bold hover:bg-emerald-700"><Download size={18}/> ส่งออก Excel</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-4">
            <div className="bg-white p-7 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-5 print:p-4 print:rounded-2xl print:shadow-none print:border-slate-200">
              <div className="p-4 bg-emerald-100 rounded-2xl text-emerald-600 print:p-3"><Calendar size={32} className="print:w-6 print:h-6"/></div>
              <div>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider mb-1">ระยะเวลาปลดหนี้รวม</p>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-4xl font-black text-slate-900 print:text-2xl">{report.totalMonths} <span className="text-sm font-bold text-slate-400 uppercase print:text-xs">เดือน</span>{hasChange && <span className="text-amber-500 ml-1 text-2xl font-black print:text-lg">*</span>}</p>
                  {isModified && diffMonths !== 0 && <span className={`text-xs font-black px-2 py-0.5 rounded-full ${diffMonths < 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{diffMonths < 0 ? `เร็วขึ้น ${Math.abs(diffMonths)}` : `ช้าลง ${diffMonths}`} เดือน</span>}
                </div>
              </div>
            </div>
            <div className="bg-white p-7 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-5 print:p-4 print:rounded-2xl print:shadow-none print:border-slate-200">
              <div className="p-4 bg-rose-100 rounded-2xl text-rose-600 print:p-3"><DollarSign size={32} className="print:w-6 print:h-6"/></div>
              <div>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider mb-1">ดอกเบี้ยรวมที่ต้องจ่าย</p>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-4xl font-black text-rose-600 print:text-2xl">฿{formatMoney(report.totalInterest)}{hasChange && <span className="text-amber-500 ml-1 text-2xl font-black print:text-lg">*</span>}</p>
                  {isModified && diffInt !== 0 && <span className={`text-xs font-black px-2 py-0.5 rounded-full ${diffInt < 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{diffInt < 0 ? `ประหยัด ฿${formatMoney(Math.abs(diffInt))}` : `จ่ายเพิ่ม ฿${formatMoney(diffInt)}`}</span>}
                </div>
              </div>
            </div>
          </div>

          {getOverrideReason() && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl text-xs font-bold flex gap-3 items-start print:hidden">
                <span className="text-xl font-black leading-none mt-1 text-amber-500">*</span> 
                <p className="leading-relaxed">{getOverrideReason()} (เปรียบเทียบกับแผน Avalanche อัตโนมัติ)</p>
              </div>
            )}

            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden print:shadow-none print:border-none">
              <div className="p-5 bg-slate-50/80 border-b font-black text-slate-700 flex justify-between items-center print:bg-white print:px-0">
                <span>จำลองการผ่อนชำระรายเดือน</span>
                <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-1 rounded-lg border border-slate-100 uppercase">Interactive Simulation</span>
              </div>
              <div className="overflow-x-auto max-h-[600px] print:max-h-none print:overflow-visible">
                {/* อัปเดตตารางสำหรับ Print Layout ตรงนี้ */}
                <table className="w-full text-right text-xs whitespace-nowrap print:whitespace-normal">
                  <thead className="bg-slate-900 text-white sticky top-0 z-30 print:bg-slate-100 print:text-slate-900 print:border-b-2 print:border-slate-300">
                    <tr className="divide-x divide-slate-800 print:divide-slate-300">
                      <th className="p-4 text-center align-middle font-black print:p-1.5 print:text-[9px]">เดือน</th>
                      <th className="p-4 text-center align-middle font-black print:p-1.5 print:text-[9px]">หนี้คงเหลือรวม</th>
                      <th className={`p-4 text-center align-middle font-black transition-colors print:p-1.5 print:text-[9px] print:bg-transparent print:text-slate-900 ${isEditingTable ? 'bg-amber-600 text-white' : 'text-emerald-400'}`}>ยอดชำระรวม {isEditingTable && <span className="block text-[8px] font-normal print:hidden">(แก้ไข)</span>}</th>
                      {report.originalCols.map(d => (
                        <Fragment key={d.id}>
                          <th className="p-4 text-center align-middle bg-slate-800/80 font-black print:p-1.5 print:bg-transparent print:text-[9px] print:leading-tight">
                            {d.name}<br/>
                            <span className={`text-[8px] font-bold tracking-widest print:text-[8px] print:text-slate-600 ${isEditingTable ? 'text-amber-400' : 'text-emerald-400'}`}>โอนจ่าย <span className="print:hidden">{isEditingTable && '(แก้ไข)'}</span></span>
                          </th>
                          <th className="p-4 text-center align-middle bg-slate-800/80 font-black print:p-1.5 print:bg-transparent print:text-[9px] print:leading-tight">
                            {d.name}<br/>
                            <span className="text-[8px] font-bold tracking-widest text-slate-500 uppercase print:text-[8px] print:text-slate-600">คงเหลือ</span>
                          </th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 print:divide-slate-200">
                    {report.rows.map((row, idx) => (
                      <tr key={idx} className={idx === 0 ? 'bg-emerald-50/50 font-bold text-slate-900' : 'hover:bg-slate-50/50 transition-colors'}>
                        <td className="p-3 border-r text-center font-bold text-slate-500 print:p-1.5 print:text-[9px] print:border-slate-200">{row.month}</td>
                        <td className="p-3 border-r font-black print:p-1.5 print:text-[9px] print:border-slate-200">฿{formatMoney(row.totalBal)}</td>
                        <td className="p-3 border-r print:p-1.5 print:text-[9px] print:border-slate-200">
                          {isEditingTable ? (
                            <input type="number" value={overrides[row.month]?.total !== undefined ? overrides[row.month].total : Math.round(row.totalPaid)} 
                              onChange={(e) => {
                                const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                const next = {...overrides};
                                if (!next[row.month]) next[row.month] = {};
                                if (val === undefined) delete next[row.month].total; else next[row.month].total = val;
                                setOverrides(next); 
                                const newRep = generateReport(next);
                                if(newRep) setReport(newRep);
                              }} className="w-20 p-1 border-2 border-amber-300 rounded-lg text-center bg-white shadow-inner font-black print:hidden outline-none" />
                          ) : null}
                          <span className={isEditingTable ? 'hidden print:inline font-black' : 'text-emerald-600 font-black'}>฿{formatMoney(row.totalPaid)}</span>
                        </td>
                        {report.originalCols.map(col => {
                          const s = row.debtsState[col.id];
                          return (
                            <Fragment key={`${col.id}-${idx}`}>
                              <td className="p-3 border-r print:p-1.5 print:text-[9px] print:border-slate-200">
                                {isEditingTable ? (
                                  <input type="number" value={overrides[row.month]?.debts?.[col.id] !== undefined ? overrides[row.month].debts[col.id] : Math.round(s.pay)}
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                      const next = {...overrides};
                                      if (!next[row.month]) next[row.month] = {};
                                      if (!next[row.month].debts) next[row.month].debts = {};
                                      if (val === undefined) delete next[row.month].debts[col.id]; else next[row.month].debts[col.id] = val;
                                      setOverrides(next); 
                                      const newRep = generateReport(next);
                                      if(newRep) setReport(newRep);
                                    }} className="w-16 p-1 border-2 border-emerald-300 rounded-lg text-center bg-white shadow-inner font-black print:hidden outline-none" />
                                ) : null}
                                <span className={isEditingTable ? 'hidden print:inline font-bold' : 'font-bold'}>{formatMoney(s.pay)}</span>
                              </td>
                              <td className="p-3 border-r text-slate-400 font-medium italic print:p-1.5 print:text-[9px] print:border-slate-200">{formatMoney(s.bal)}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
