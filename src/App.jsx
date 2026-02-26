import React, { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { 
  PlusCircle, Trash2, Calculator, DollarSign, 
  Calendar, TrendingDown, Download, Upload,
  Printer, Cloud, User, AlertCircle,
  ChevronDown, ChevronUp, BookOpen, Edit, LogOut,
  Share2, Copy, Check, X
} from 'lucide-react';
import { initializeApp } from "firebase/app";
import { 
  getAuth, signInAnonymously, signInWithCustomToken,
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut 
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// --- MathInput Component (ระบบกรอกตัวเลขรองรับการคำนวณ) ---
const MathInput = ({ value, onChange, onBlur, className, placeholder }) => {
  const [localValue, setLocalValue] = useState(value !== undefined ? String(value) : '');
  const [isFocused, setIsFocused] = useState(false);
  const [preview, setPreview] = useState(null);

  // อัปเดตข้อมูลจากภายนอก "เฉพาะตอนที่ไม่ได้กำลังพิมพ์อยู่" เพื่อแก้ปัญหาลบแล้วเด้งกลับ
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value !== undefined ? String(value) : '');
    }
  }, [value, isFocused]);

  const evaluate = (str) => {
    if (!str) return null;
    try {
      const sanitized = str.toString().replace(/[^0-9+\-*/.()]/g, '');
      if (!sanitized) return null;
      if (!/[+\-*/()]/.test(sanitized)) return null; // คำนวณเฉพาะเมื่อมีเครื่องหมาย
      const res = new Function('return ' + sanitized)();
      return isFinite(res) ? res : null;
    } catch {
      return null;
    }
  };

  const handleChange = (e) => {
    // กรองอนุญาตให้พิมพ์เฉพาะตัวเลขและเครื่องหมายคำนวณ
    const val = e.target.value.replace(/[^0-9+\-*/.() ]/g, '');
    setLocalValue(val);
    const res = evaluate(val);
    setPreview(res);
    // ส่งค่าแบบสดๆ ให้ Parent เพื่อให้คำนวณเบื้องหลัง
    if (onChange) onChange({ target: { value: val } });
  };

  const handleBlur = (e) => {
    setIsFocused(false);
    const res = evaluate(localValue);
    let finalVal = localValue;
    
    if (res !== null) {
      // หากเป็นสูตรคณิตศาสตร์ที่สมบูรณ์ ให้แปลงเป็นผลลัพธ์
      finalVal = Number(res).toFixed(2);
    } else if (localValue && !isNaN(parseFloat(localValue))) {
      // หากเป็นตัวเลขปกติ ให้จัดฟอร์แมตทศนิยม 2 ตำแหน่ง
      finalVal = Number(parseFloat(localValue)).toFixed(2);
    } else {
      finalVal = ''; 
    }

    setLocalValue(finalVal);
    // ส่งข้อมูลขั้นสุดท้ายกลับไป
    if (onChange && finalVal !== localValue) onChange({ target: { value: finalVal } });
    if (onBlur) onBlur({ target: { value: finalVal } });
    setPreview(null);
  };

  const isWFull = className && className.includes('w-full');

  return (
    <div className={`relative inline-block ${isWFull ? 'w-full' : ''} align-middle`}>
      {isFocused && preview !== null && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-lg whitespace-nowrap z-50 animate-in fade-in zoom-in duration-200 pointer-events-none print:hidden">
          = {Number(preview).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-emerald-700"></div>
        </div>
      )}
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        className={className}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
};

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
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // --- Share Logic ---
  const handleCopyLink = () => {
    const el = document.createElement('textarea');
    el.value = window.location.href;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };
  
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareTitle = encodeURIComponent('Debt Avalanche Planner | วางแผนปลดหนี้อัจฉริยะ');

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
      
      let rawTotal = currentMonthOverride.total;
      let parsedTotal = parseFloat(rawTotal);
      let currentMonthBudget = (rawTotal !== undefined && rawTotal !== '' && !isNaN(parsedTotal)) ? parsedTotal : baseBgt;
      
      let extra = currentMonthBudget;
      let actualPaidThisMonth = 0;

      sortedDebts.forEach(d => {
        let int = d.bal * (d.rate / 100 / 12);
        d.bal += int;
        totalInterest += int;
        d.pay = 0;
      });

      sortedDebts.forEach(d => {
        let rawDebt = currentMonthOverride.debts?.[d.id];
        let parsedDebt = parseFloat(rawDebt);
        if (d.bal > 0 && rawDebt !== undefined && rawDebt !== '' && !isNaN(parsedDebt)) {
          let manualPay = Math.min(parsedDebt, extra, d.bal);
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

  const exportDebts = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(debts, null, 2));
      const downloadNode = document.createElement('a');
      downloadNode.setAttribute("href", dataStr);
      downloadNode.setAttribute("download", `debt_list_${userName || 'backup'}.json`);
      document.body.appendChild(downloadNode);
      downloadNode.click();
      downloadNode.remove();
    } catch (err) {
      setErrorMessage("เกิดข้อผิดพลาดในการส่งออกข้อมูล");
    }
  };

  const importDebts = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        if (Array.isArray(importedData)) {
          // ตรวจสอบและจัดการข้อมูลที่โหลดเข้ามา
          const validDebts = importedData.map((d, i) => ({
            id: d.id || new Date().getTime() + i,
            name: d.name || `หนี้ ${i + 1}`,
            balance: d.balance !== undefined ? d.balance : '',
            rate: d.rate !== undefined ? d.rate : '',
            minPay: d.minPay !== undefined ? d.minPay : ''
          }));
          setDebts(validDebts);
        } else {
          setErrorMessage("❌ รูปแบบไฟล์ไม่ถูกต้อง\nกรุณาใช้ไฟล์ .json ที่ได้จากการกดปุ่ม 'ส่งออก' เท่านั้น");
        }
      } catch (err) {
        setErrorMessage("❌ ไม่สามารถอ่านไฟล์ได้\nกรุณาตรวจสอบว่าไฟล์ไม่เสียหาย");
      }
    };
    reader.readAsText(file);
    event.target.value = null; // รีเซ็ตค่าเพื่อให้สามารถเลือกไฟล์เดิมซ้ำได้
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

  const activeOverrideKeys = Object.keys(overrides).filter(m => {
    const t = overrides[m].total;
    const d = overrides[m].debts;
    return (t !== undefined && t !== '') || (d && Object.values(d).some(v => v !== undefined && v !== ''));
  });

  const getOverrideDetailsList = () => {
    if (activeOverrideKeys.length === 0) return [];
    const sortedKeys = activeOverrideKeys.map(Number).sort((a, b) => a - b);
    let details = [];
    sortedKeys.forEach(m => {
      let part = `เดือนที่ ${m}: `;
      let actions = [];
      if (overrides[m].total !== undefined && overrides[m].total !== '') actions.push("แก้ไขยอดจ่ายรวม");
      if (overrides[m].debts && Object.values(overrides[m].debts).some(v => v !== undefined && v !== '')) actions.push("แก้ไขยอดโอนรายก้อน");
      
      if (actions.length > 0) {
        part += actions.join(" และ ");
        details.push(part);
      }
    });
    return details;
  };

  const formatMoney = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const isModified = activeOverrideKeys.length > 0;
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
              <svg className="w-6 h-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              เข้าสู่ระบบด้วย Google
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

      {/* --- Share Modal --- */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 print:hidden">
          <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full space-y-6 border border-slate-100 relative animate-in zoom-in-95 duration-200">
            <button onClick={() => setIsShareModalOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition bg-slate-50 rounded-full p-1"><X size={20}/></button>
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-2"><Share2 size={24} /></div>
              <h2 className="text-xl font-black text-slate-900">แชร์ให้เพื่อน</h2>
              <p className="text-slate-500 text-sm">ส่งต่อเครื่องมือวางแผนปลดหนี้ให้คนที่คุณห่วงใย</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
                <div className="w-10 h-10 bg-[#1877F2] rounded-full flex items-center justify-center text-white">
                  <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </div>
                <span className="text-xs font-bold text-slate-700">Facebook</span>
              </a>
              <a href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
                <div className="w-10 h-10 bg-[#00B900] rounded-full flex items-center justify-center text-white">
                  <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 3.93 8.878 9.387 9.61.365.078.863.242.991.554.116.28.075.714.036 1.002-.005.037-.044.275-.055.337-.043.26-.208 1.01.884.549 1.092-.461 5.888-3.468 8.163-6.023C22.693 14.505 24 12.518 24 10.304z"/></svg>
                </div>
                <span className="text-xs font-bold text-slate-700">LINE</span>
              </a>
              <a href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${shareTitle}`} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
                <div className="w-10 h-10 bg-black rounded-full flex items-center justify-center text-white">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </div>
                <span className="text-xs font-bold text-slate-700">X (Twitter)</span>
              </a>
            </div>
            <button onClick={handleCopyLink} className={`w-full py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all border-2 ${isCopied ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
              {isCopied ? <Check size={18}/> : <Copy size={18}/>}
              {isCopied ? 'คัดลอกลิงก์แล้ว!' : 'คัดลอกลิงก์ (Copy Link)'}
            </button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-6">
        {/* --- ส่วนหัวเฉพาะตอนพิมพ์ (Print Header) --- */}
        <div className="hidden print:block print:mb-4 print:border-b print:border-slate-200 print:pb-4">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2"><TrendingDown className="text-emerald-500" size={24}/> Debt Avalanche Planner</h1>
              <p className="text-slate-600 mt-2">แผนผังการผ่อนชำระหนี้ของ: <span className="font-bold text-slate-900 text-lg">{userName || 'ผู้ใช้งานทั่วไป'}</span></p>
            </div>
            <div className="text-right text-xs text-slate-500 space-y-1">
              <p>งบชำระ/เดือน: <span className="font-bold text-slate-900">฿{formatMoney(budget)}</span> | ขั้นต่ำ: <span className="font-bold text-slate-900">{Number(minPercent).toFixed(2)}%</span></p>
              <p>วันที่พิมพ์: <span className="font-medium">{new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></p>
            </div>
          </div>
        </div>

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
            <button onClick={() => setIsShareModalOpen(true)} className="text-xs text-slate-600 hover:text-emerald-600 flex items-center gap-1.5 font-bold bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm hover:bg-slate-50 transition ml-2">
              <Share2 size={14}/> แชร์แอป
            </button>
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
              
              <div className="mt-5 p-5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                <h3 className="font-bold text-emerald-800 mb-3 flex items-center gap-2">📊 ตัวอย่างการคำนวณในแต่ละเดือน (ลดต้นลดดอก):</h3>
                <div className="space-y-4 text-xs">
                  <p>
                    <strong className="text-slate-700 text-sm">1. การคิดดอกเบี้ยรายเดือน:</strong> <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-emerald-700">(เงินต้นคงเหลือ × อัตราดอกเบี้ยต่อปี %) ÷ 12</code><br/>
                    <span className="text-slate-500 mt-1 block">เช่น หนี้ 10,000 บ. ดอกเบี้ย 25% ➔ (10,000 × 0.25) ÷ 12 = <span className="text-rose-500 font-bold">ดอกเบี้ย 208.33 บ.</span> (จะถูกนำไปบวกกับเงินต้นตั้งต้นของเดือนนั้น)</span>
                  </p>
                  
                  <p>
                    <strong className="text-slate-700 text-sm">2. การจ่ายขั้นต่ำ:</strong> <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-emerald-700">เงินต้น × % ขั้นต่ำ (เช่น 5%)</code><br/>
                    <span className="text-slate-500 mt-1 block">เช่น 10,000 × 5% = จ่ายขั้นต่ำ 500 บ. (หากเว้นว่างไว้ ระบบจะคำนวณขั้นต่ำให้ที่ 5% หรือไม่ต่ำกว่า 500 บาทโดยอัตโนมัติ)</span>
                  </p>

                  <p>
                    <strong className="text-slate-700 text-sm">3. การหักชำระ (ลดต้นลดดอก):</strong> <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-emerald-700">ยอดคงเหลือใหม่ = (เงินต้นเดิม + ดอกเบี้ยรายเดือน) - ยอดจ่าย</code><br/>
                    <span className="text-slate-500 mt-1 block">เช่น (10,000 + 208.33) - 500 = หนี้คงเหลือยกไปเดือนถัดไป <span className="text-emerald-600 font-bold">9,708.33 บ.</span></span>
                  </p>
                  
                  <p>
                    <strong className="text-slate-700 text-sm">4. พลังของการโปะ (Avalanche Extra):</strong> <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-emerald-700">เงินโปะ = งบชำระรายเดือน - ผลรวมขั้นต่ำทุกก้อน</code><br/>
                    <span className="text-slate-500 mt-1 block">เช่น มีงบ 16,000 บ. หักจ่ายขั้นต่ำรวมทุกหนี้แล้วเหลือ 12,000 บ. ➔ ระบบจะนำ 12,000 บ. นี้ไปโปะก้อนที่ <strong>"ดอกเบี้ย % สูงที่สุด"</strong> ทันที ทำให้เงินต้นลดฮวบและประหยัดดอกเบี้ยในเดือนถัดไปมหาศาล!</span>
                  </p>
                </div>
              </div>
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
               <MathInput value={budget} onChange={(e) => setBudget(e.target.value)} className="w-28 p-2 rounded-lg border-slate-200 outline-none font-bold text-center bg-white shadow-inner" />
             </div>
             <div>
               <label className="text-xs font-bold text-emerald-800 block mb-1">ขั้นต่ำ (%)</label>
               <MathInput value={minPercent} onChange={(e) => setMinPercent(e.target.value)} className="w-16 p-2 rounded-lg border-slate-200 outline-none font-bold text-center bg-white shadow-inner" />
             </div>
           </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:hidden">
          <div className="p-4 border-b flex justify-between items-center bg-slate-50/50 flex-wrap gap-3">
            <h2 className="font-bold text-slate-700">รายการหนี้สิน</h2>
            <div className="flex gap-2 items-center flex-wrap">
              <input type="file" accept=".json" id="import-debts" className="hidden" onChange={importDebts} />
              <label htmlFor="import-debts" className="text-xs font-bold px-3 py-2 bg-white border border-slate-200 rounded-xl flex items-center gap-1.5 shadow-sm hover:bg-slate-50 cursor-pointer transition text-slate-600">
                <Upload size={14} className="text-blue-500"/> นำเข้า
              </label>
              <button onClick={exportDebts} className="text-xs font-bold px-3 py-2 bg-white border border-slate-200 rounded-xl flex items-center gap-1.5 shadow-sm hover:bg-slate-50 transition text-slate-600">
                <Download size={14} className="text-blue-500"/> ส่งออก
              </button>
              <button onClick={handleAddDebt} className="text-xs font-bold px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 shadow-sm hover:bg-emerald-100 transition text-emerald-700">
                <PlusCircle size={16} className="text-emerald-600"/> เพิ่มรายการ
              </button>
            </div>
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
                    <td className="p-2 min-w-[100px]"><MathInput value={d.balance} onChange={(e) => handleChange(d.id, 'balance', e.target.value)} className="w-full p-2 border border-slate-100 rounded-lg text-sm font-bold bg-white shadow-inner" /></td>
                    <td className="p-2 min-w-[80px]"><MathInput value={d.rate} onChange={(e) => handleChange(d.id, 'rate', e.target.value)} className="w-full p-2 border border-slate-100 rounded-lg text-sm font-bold bg-white shadow-inner" /></td>
                    <td className="p-2 min-w-[100px]"><MathInput value={d.minPay} onChange={(e) => handleChange(d.id, 'minPay', e.target.value)} placeholder={getSuggestions(d.balance).calcMin.toFixed(2)} className="w-full p-2 border border-slate-100 rounded-lg text-sm bg-white shadow-inner" /></td>
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

          {isModified && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl text-xs font-bold flex gap-3 items-start print:hidden">
              <span className="text-xl font-black leading-none mt-1 text-amber-500">*</span> 
              <p className="leading-relaxed">ระยะเวลาปลดหนี้/ดอกเบี้ยรวมเปลี่ยนแปลง เนื่องจากมีการปรับแต่งข้อมูลด้วยตนเองรวม {activeOverrideKeys.length} เดือน (ดูรายละเอียดด้านล่างตาราง)</p>
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
                            <MathInput value={overrides[row.month]?.total !== undefined ? overrides[row.month].total : Number(row.totalPaid).toFixed(2)} 
                              onChange={(e) => {
                                const val = e.target.value;
                                const next = {...overrides};
                                if (!next[row.month]) next[row.month] = {};
                                next[row.month].total = val;
                                setOverrides(next); 
                                const newRep = generateReport(next);
                                if(newRep) setReport(newRep);
                              }} 
                              onBlur={(e) => {
                                if (e.target.value === '') {
                                  const next = {...overrides};
                                  if (next[row.month]) {
                                    delete next[row.month].total;
                                    setOverrides(next);
                                    const newRep = generateReport(next);
                                    if(newRep) setReport(newRep);
                                  }
                                }
                              }}
                              className="w-20 p-1 border-2 border-amber-300 rounded-lg text-center bg-white shadow-inner font-black print:hidden outline-none" />
                          ) : null}
                          <span className={isEditingTable ? 'hidden print:inline font-black' : 'text-emerald-600 font-black'}>฿{formatMoney(row.totalPaid)}</span>
                        </td>
                        {report.originalCols.map(col => {
                          const s = row.debtsState[col.id];
                          return (
                            <Fragment key={`${col.id}-${idx}`}>
                              <td className="p-3 border-r print:p-1.5 print:text-[9px] print:border-slate-200">
                                {isEditingTable ? (
                                  <MathInput value={overrides[row.month]?.debts?.[col.id] !== undefined ? overrides[row.month].debts[col.id] : Number(s.pay).toFixed(2)}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const next = {...overrides};
                                      if (!next[row.month]) next[row.month] = {};
                                      if (!next[row.month].debts) next[row.month].debts = {};
                                      next[row.month].debts[col.id] = val;
                                      setOverrides(next); 
                                      const newRep = generateReport(next);
                                      if(newRep) setReport(newRep);
                                    }} 
                                    onBlur={(e) => {
                                      if (e.target.value === '') {
                                        const next = {...overrides};
                                        if (next[row.month] && next[row.month].debts) {
                                          delete next[row.month].debts[col.id];
                                          setOverrides(next);
                                          const newRep = generateReport(next);
                                          if(newRep) setReport(newRep);
                                        }
                                      }
                                    }}
                                    className="w-16 p-1 border-2 border-emerald-300 rounded-lg text-center bg-white shadow-inner font-black print:hidden outline-none" />
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
              
              {/* --- แสดงบันทึกการปรับแต่งรูปแบบ List ท้ายตาราง (สำหรับดูบนเว็บและตอนพิมพ์) --- */}
              {isModified && (
                <div className="p-5 bg-slate-50 border-t print:bg-white print:border-t-2 print:border-slate-300 print:mt-4 print:p-2">
                  <h4 className="font-bold text-sm text-slate-800 mb-2 print:text-xs">📝 บันทึกการปรับแต่งแผน (เปรียบเทียบกับแผนอัตโนมัติ):</h4>
                  <ul className="list-disc pl-6 text-xs text-slate-600 space-y-1 print:text-[10px]">
                    {getOverrideDetailsList().map((detail, idx) => (
                      <li key={idx}>{detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
