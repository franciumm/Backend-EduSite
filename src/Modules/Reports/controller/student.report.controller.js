import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { format, endOfMonth, startOfDay, endOfDay } from "date-fns";

import studentModel from "../../../../DB/models/student.model.js";
import { SubassignmentModel } from "../../../../DB/models/submitted_assignment.model.js";
import { SubexamModel } from "../../../../DB/models/submitted_exams.model.js";
import { asyncHandler } from "../../../utils/erroHandling.js";

/** Resolve the date range from query. */
function resolveDateRange({ from, to, year, fromMonth, toMonth }) {
  const now = new Date();
  if (from && to) return { from: startOfDay(new Date(from)), to: endOfDay(new Date(to)) };

  if (year && (fromMonth || toMonth)) {
    const fm = fromMonth || 1;
    const tm = toMonth || fm;
    const fromD = startOfDay(new Date(year, fm - 1, 1));
    const toD = endOfDay(endOfMonth(new Date(year, tm - 1, 1)));
    return { from: fromD, to: toD };
  }

  // Default: current calendar year
  return {
    from: startOfDay(new Date(now.getFullYear(), 0, 1)),
    to: endOfDay(new Date(now.getFullYear(), 11, 31)),
  };
}

/** Build metrics and flattened lists for the report. */
async function gatherStudentData(studentId, from, to) {
  const student = await studentModel
    .findById(studentId)
    .populate({ path: "groupIds", select: "groupname" })
    .lean();

  if (!student) throw new Error("Student not found.");

  // Assignments submissions in range
  const assSubs = await SubassignmentModel.find({
    studentId,
    createdAt: { $gte: from, $lte: to },
  })
    .populate({ path: "assignmentId", select: "name endDate startDate" })
    .lean();

  // Exams submissions in range
  const examSubs = await SubexamModel.find({
    studentId,
    createdAt: { $gte: from, $lte: to },
  })
    .populate({ path: "examId", select: "Name" })
    .lean();

  // Compute stats
  const assignments = assSubs.map((s) => {
    const a = s.assignmentId || {};
    const due = a.endDate ? new Date(a.endDate) : null;
    const submittedAt = s.createdAt ? new Date(s.createdAt) : null;
    const late = due && submittedAt ? submittedAt > due : false;

    return {
      name: a.name || s.assignmentname || "Assignment",
      dueDate: due ? format(due, "yyyy-MM-dd") : "-",
      submittedAt: submittedAt ? format(submittedAt, "yyyy-MM-dd HH:mm") : "-",
      score: s.score ?? null,
      isMarked: !!s.isMarked,
      notes: s.notes || "",
      teacherFeedback: s.teacherFeedback || "",
      status: submittedAt ? (late ? "Late" : "On-time") : "Missing",
    };
  });

  const exams = examSubs.map((e) => {
    const submittedAt = e.createdAt ? new Date(e.createdAt) : null;
    return {
      name: (e.examId && e.examId.Name) || e.examname || "Exam",
      version: e.version ?? 1,
      submittedAt: submittedAt ? format(submittedAt, "yyyy-MM-dd HH:mm") : "-",
      score: e.score ?? null,
      notes: e.notes || "",
      teacherFeedback: e.teacherFeedback || "",
    };
  });

  // Aggregates
  const avg = (arr) => {
    const nums = arr.map((v) => (typeof v === "number" ? v : null)).filter((v) => v !== null);
    if (!nums.length) return null;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
    // keep 2 decimals
  };

  const summary = {
    studentName: `${student.firstName || ""} ${student.lastName || ""}`.trim() || student.userName,
    group: student.groupIds?.groupname ?? "-",
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
    assignments: {
      total: assignments.length,
      marked: assignments.filter((a) => a.isMarked).length,
      late: assignments.filter((a) => a.status === "Late").length,
      missing: assignments.filter((a) => a.status === "Missing").length,
      avgScore: avg(assignments.map((a) => a.score)),
    },
    exams: {
      total: exams.length,
      avgScore: avg(exams.map((e) => e.score)),
    },
  };

  return { student, summary, assignments, exams };
}

/** ====== PDF ====== */
function streamPdf(res, { summary, assignments, exams }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="report-${summary.studentName.replace(/\s+/g, "_")}.pdf"`
  );

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  const H = (t, s = 18) => {
    doc.fontSize(s).text(t);
  };
  const L = (left, right) => {
    doc.fontSize(11).text(`${left}`, { continued: true }).text(`  ${right}`);
  };
  const line = () =>
    doc
      .moveDown(0.5)
      .strokeColor("#aaa")
      .moveTo(40, doc.y)
      .lineTo(555, doc.y)
      .stroke()
      .moveDown(0.5);

  // small helper for simple tables
  const writeTable = (title, headers, rows) => {
    H(title, 14);
    doc.moveDown(0.3);
    doc.fontSize(11).text(headers.join("  |  "));
    line();
    rows.forEach((r) => {
      const row = headers.map((h) => r[h] ?? r[h.toLowerCase()] ?? "").join("  |  ");
      if (doc.y > 720) doc.addPage();
      doc.text(row);
    });
    doc.moveDown(0.5);
  };

  // Header
  H("Student Performance Report", 22);
  doc.moveDown(0.3);
  L("Student:", summary.studentName);
  L("Group:", ` ${summary.group}`);
  L("Period:", `${summary.from} → ${summary.to}`);
  line();

  // Summary
  H("Summary", 16);
  doc.moveDown(0.3);
  L(
    "Assignments:",
    `total=${summary.assignments.total}, marked=${summary.assignments.marked}, late=${summary.assignments.late}, missing=${summary.assignments.missing}, avgScore=${summary.assignments.avgScore ?? "-"}`
  );
  L("Exams:", `total=${summary.exams.total}, avgScore=${summary.exams.avgScore ?? "-"}`);
  line();

  // Assignments table
  writeTable(
    "Assignments",
    ["name", "dueDate", "submittedAt", "status", "score", "isMarked", "teacherFeedback"],
    assignments.map((a) => ({
      name: a.name,
      dueDate: a.dueDate,
      submittedAt: a.submittedAt,
      status: a.status,
      score: a.score ?? "-",
      isMarked: a.isMarked ? "Yes" : "No",
      teacherFeedback: a.teacherFeedback?.slice(0, 60) || "-",
    }))
  );

  // Exams table (with teacherFeedback)
  writeTable(
    "Exams",
    ["name", "version", "submittedAt", "score", "teacherFeedback", "notes"],
    exams.map((e) => ({
      name: e.name,
      version: e.version,
      submittedAt: e.submittedAt,
      score: e.score ?? "-",
      teacherFeedback: e.teacherFeedback?.slice(0, 60) || "-",
      notes: e.notes?.slice(0, 60) || "-",
    }))
  );

  doc.end();
}

/** ====== Excel (xlsx) ====== */
async function streamExcel(res, { summary, assignments, exams }) {
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="report-${summary.studentName.replace(/\s+/g, "_")}.xlsx"`
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  const wb = new ExcelJS.Workbook();

  // Summary
  const s = wb.addWorksheet("Summary");
  s.addRows([
    ["Student", summary.studentName],
    ["Group", summary.group],
    ["Period", `${summary.from} → ${summary.to}`],
    [],
    ["Assignments Total", summary.assignments.total],
    ["Assignments Marked", summary.assignments.marked],
    ["Assignments Late", summary.assignments.late],
    ["Assignments Missing", summary.assignments.missing],
    ["Assignments Avg Score", summary.assignments.avgScore ?? "-"],
    [],
    ["Exams Total", summary.exams.total],
    ["Exams Avg Score", summary.exams.avgScore ?? "-"],
  ]);

  // Assignments
  const a = wb.addWorksheet("Assignments");
  a.columns = [
    { header: "Name", key: "name", width: 30 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Submitted At", key: "submittedAt", width: 20 },
    { header: "Status", key: "status", width: 12 },
    { header: "Score", key: "score", width: 10 },
    { header: "Marked", key: "isMarked", width: 10 },
    { header: "Teacher Feedback", key: "teacherFeedback", width: 40 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  a.addRows(
    assignments.map((x) => ({
      ...x,
      isMarked: x.isMarked ? "Yes" : "No",
      score: x.score ?? "",
    }))
  );

  // Exams
  const e = wb.addWorksheet("Exams");
  e.columns = [
    { header: "Name", key: "name", width: 30 },
    { header: "Version", key: "version", width: 10 },
    { header: "Submitted At", key: "submittedAt", width: 20 },
    { header: "Score", key: "score", width: 10 },
    { header: "Teacher Feedback", key: "teacherFeedback", width: 40 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  e.addRows(
    exams.map((x) => ({
      ...x,
      score: x.score ?? "",
      teacherFeedback: x.teacherFeedback ?? "",
    }))
  );

  await wb.xlsx.write(res);
  res.end();
}

/** ====== Controller ====== */
export const generateStudentReport = asyncHandler(async (req, res, next) => {
  // support params or merged body/query (depending on your Joi middleware)
  const studentId = req.params.studentId || req.body.studentId || req.query.studentId;
  const format = req.body.format || req.query.format || "pdf";
  const from = req.body.from || req.query.from;
  const to = req.body.to || req.query.to;
  const year = req.body.year || req.query.year;
  const fromMonth = req.body.fromMonth || req.query.fromMonth;
  const toMonth = req.body.toMonth || req.query.toMonth;

  if (!studentId) return next(new Error("studentId is required", { cause: 400 }));

  const { from: f, to: t } = resolveDateRange({ from, to, year, fromMonth, toMonth });
  const data = await gatherStudentData(studentId, f, t);

  if (String(format).toLowerCase() === "xlsx") {
    await streamExcel(res, data);
  } else {
    streamPdf(res, data);
  }
});
