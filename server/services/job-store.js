const jobs = new Map();
export const jobStore = {
  create(job) { jobs.set(job.id, job); return job; },
  get(id) { return jobs.get(id); },
  update(id, values) { const job = jobs.get(id); if (!job) return null; Object.assign(job, values); return job; },
  clear() { jobs.clear(); }
};
