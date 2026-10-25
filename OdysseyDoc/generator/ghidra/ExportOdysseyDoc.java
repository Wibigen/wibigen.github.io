// Exports hook-safety data and the call graph for OdysseyDoc.
// Run it on your Super Mario Odyssey 1.0.0 main program (Script Manager, or analyzeHeadless).
// Tested with Ghidra 11.3.2.
//
// For every function it writes one JSON line:
//   {"a":"<entry offset hex>","s":<size>,"n":"<name>",
//    "i":[["mnemonic","operands",pcRelative(0/1)], ...first 6 instructions...],
//    "into":[["<target hex>","<from hex>"], ...]   flow references landing on entry+4 .. entry+20,
//    "loop":["<from hex>", ...]                     branches from inside the function back to the entry,
//    "c":["<callee entry hex>", ...]}               direct callees
//
// Then: python generator/build_all.py ... --ghidra-export <file>
//
// @category OdysseyDoc
// @author OdysseyDoc

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Set;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.lang.OperandType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.ReferenceManager;

public class ExportOdysseyDoc extends GhidraScript {

    private static final int INSTRUCTIONS = 6;      // exlaunch patches at most 5 instructions
    private static final int PATCH_BYTES = 20;

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    private static String hex(Address a) {
        return "\"" + Long.toHexString(a.getOffset()) + "\"";
    }

    private static boolean isPcRelative(Instruction ins) {
        String m = ins.getMnemonicString().toLowerCase();
        if (m.startsWith("_")) m = m.substring(1);
        if (m.equals("adr") || m.equals("adrp") || m.equals("b") || m.equals("bl") || m.startsWith("b.")
                || m.equals("cbz") || m.equals("cbnz") || m.equals("tbz") || m.equals("tbnz")) {
            return true;
        }
        if ((m.equals("ldr") || m.equals("ldrsw") || m.equals("prfm")) && ins.getNumOperands() >= 2) {
            // literal load: second operand is an address, not a [register, ...] form
            int t = ins.getOperandType(1);
            return (t & OperandType.REGISTER) == 0 && (t & OperandType.DYNAMIC) == 0;
        }
        return false;
    }

    @Override
    public void run() throws Exception {
        File out;
        String[] args = getScriptArgs();
        if (args != null && args.length > 0) out = new File(args[0]);
        else out = askFile("Save OdysseyDoc export", "Save");

        Listing listing = currentProgram.getListing();
        ReferenceManager refs = currentProgram.getReferenceManager();
        int total = currentProgram.getFunctionManager().getFunctionCount();
        monitor.initialize(total);
        monitor.setMessage("OdysseyDoc export");

        int n = 0;
        try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(out), StandardCharsets.UTF_8))) {
            FunctionIterator it = listing.getFunctions(true);
            while (it.hasNext()) {
                if (monitor.isCancelled()) break;
                Function f = it.next();
                if (f.isExternal() || (f.isThunk() && f.getBody().getNumAddresses() == 0)) continue;
                Address entry = f.getEntryPoint();
                StringBuilder line = new StringBuilder(256);
                line.append("{\"a\":").append(hex(entry));
                line.append(",\"s\":").append(f.getBody().getNumAddresses());
                line.append(",\"n\":").append(json(f.getName(true)));

                // first instructions
                line.append(",\"i\":[");
                Instruction ins = listing.getInstructionAt(entry);
                for (int k = 0; k < INSTRUCTIONS && ins != null && f.getBody().contains(ins.getAddress()); k++) {
                    if (k > 0) line.append(',');
                    StringBuilder ops = new StringBuilder();
                    for (int o = 0; o < ins.getNumOperands(); o++) {
                        if (o > 0) ops.append(", ");
                        ops.append(ins.getDefaultOperandRepresentation(o));
                    }
                    line.append('[').append(json(ins.getMnemonicString())).append(',').append(json(ops.toString()))
                        .append(',').append(isPcRelative(ins) ? 1 : 0).append(']');
                    ins = ins.getNext();
                }
                line.append(']');

                // flow references landing inside the patched bytes (entry+4 .. entry+PATCH_BYTES-4)
                line.append(",\"into\":[");
                boolean first = true;
                long size = f.getBody().getNumAddresses();
                for (int off = 4; off < PATCH_BYTES && off < size; off += 4) {
                    Address t = entry.add(off);
                    ReferenceIterator ri = refs.getReferencesTo(t);
                    while (ri.hasNext()) {
                        Reference r = ri.next();
                        if (!r.getReferenceType().isFlow()) continue;
                        Address from = r.getFromAddress();
                        if (from.compareTo(entry) >= 0 && from.compareTo(entry.add(off)) < 0) continue; // fall-through
                        if (!first) line.append(',');
                        line.append('[').append(hex(t)).append(',').append(hex(from)).append(']');
                        first = false;
                    }
                }
                line.append(']');

                // branches from inside the function back to its entry (loops)
                line.append(",\"loop\":[");
                first = true;
                ReferenceIterator ri = refs.getReferencesTo(entry);
                while (ri.hasNext()) {
                    Reference r = ri.next();
                    if (!r.getReferenceType().isJump()) continue;
                    if (!f.getBody().contains(r.getFromAddress())) continue;
                    if (!first) line.append(',');
                    line.append(hex(r.getFromAddress()));
                    first = false;
                }
                line.append(']');

                // direct callees
                line.append(",\"c\":[");
                first = true;
                Set<Function> called = f.getCalledFunctions(monitor);
                for (Function c : called) {
                    if (c.isExternal()) continue;
                    if (!first) line.append(',');
                    line.append(hex(c.getEntryPoint()));
                    first = false;
                }
                line.append("]}\n");
                w.write(line.toString());
                n++;
                monitor.incrementProgress(1);
            }
        }
        println("OdysseyDoc: exported " + n + " functions to " + out.getAbsolutePath());
    }
}
