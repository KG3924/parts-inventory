    function compactAlnum(s) {
      return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    function digitsOnly(s) {
      return String(s || '').replace(/\D/g, '');
    }

    /** Partial name / part # search for typed Scan lookup (not camera). */
    function itemMatchesQuery(item, raw) {
      const q = String(raw || '').trim();
      if (!q) return false;
      const ql = q.toLowerCase();
      const name = (item.name || '').toLowerCase();
      const pn = (item.part_number || '').toLowerCase();
      const bc = (item.barcode || '').toLowerCase();
      if (name.includes(ql) || pn.includes(ql) || bc.includes(ql)) return true;
      const qc = compactAlnum(q);
      if (qc.length >= 2) {
        if (compactAlnum(item.part_number).includes(qc) || compactAlnum(item.barcode).includes(qc)) return true;
      }
      const qd = digitsOnly(q);
      if (qd.length >= 3 && digitsOnly(item.part_number).includes(qd)) return true;
      return false;
    }

    function searchInventoryMatches(raw) {
      const q = String(raw || '').trim();
      if (!q) return [];
      const ql = q.toLowerCase();
      const qc = compactAlnum(q);
      const scored = [];
      inventory.forEach(i => {
        if (!itemMatchesQuery(i, q)) return;
        const pn = (i.part_number || '').toLowerCase();
        const name = (i.name || '').toLowerCase();
        let score = 10;
        if (pn === ql || (i.barcode || '').toLowerCase() === ql) score = 100;
        else if (pn.startsWith(ql)) score = 80;
        else if (compactAlnum(i.part_number) === qc) score = 75;
        else if (name.startsWith(ql)) score = 60;
        else if (name.includes(ql)) score = 40;
        scored.push({ item: i, score });
      });
      scored.sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(b.item.name || ''));
      return scored.map(s => s.item);
    }
