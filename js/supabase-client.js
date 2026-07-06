/**
 * Catcher.AI — Supabase Client
 * 
 * Shared initialization for Supabase Auth, DB access, and Edge Function calls.
 * Loaded via <script src="js/supabase-client.js"></script> after the Supabase CDN.
 * 
 * Exposes:
 *   window.cai.supabase  — the Supabase client instance
 *   window.cai.auth      — auth helpers (requireAuth, requireSubscription, getSubscriptionStatus, signOut, etc.)
 *   window.cai.api       — Edge Function wrappers (analyze, mail)
 *   window.cai.db        — DB helpers (profiles, reports, analyses, disputes, letters, scores, addresses)
 */
;(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG — replaced at deploy time or read from meta tags
  // ---------------------------------------------------------------------------
  const SUPABASE_URL = document.querySelector('meta[name="supabase-url"]')?.content || 'YOUR_SUPABASE_URL';
  const SUPABASE_ANON_KEY = document.querySelector('meta[name="supabase-anon-key"]')?.content || 'YOUR_SUPABASE_ANON_KEY';

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---------------------------------------------------------------------------
  // AUTH HELPERS
  // ---------------------------------------------------------------------------
  const auth = {
    /** Get current session (null if not logged in) */
    async getSession() {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) console.error('[cai] getSession error:', error.message);
      return session;
    },

    /** Get current user (null if not logged in) */
    async getUser() {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) console.error('[cai] getUser error:', error.message);
      return user;
    },

    /** Redirect to paywall.html if no valid session */
    async requireAuth() {
      const session = await this.getSession();
      if (!session) {
        window.location.replace('paywall.html');
        // Throw to prevent any calling code from continuing
        throw new Error('AUTH_REDIRECT');
      }
      return session;
    },

    /** Check subscription_status on profiles table; redirect if inactive */
    async requireSubscription() {
      const session = await this.requireAuth();
      // If requireAuth threw AUTH_REDIRECT, we won't reach here

      const status = await this.getSubscriptionStatus();
      if (!status || status === 'inactive' || status === 'canceled') {
        window.location.replace('paywall.html?reason=subscription');
        throw new Error('SUBSCRIPTION_REDIRECT');
      }
      return status;
    },

    /** Get subscription_status from profiles table */
    async getSubscriptionStatus() {
      const { data, error } = await supabase
        .from('profiles')
        .select('subscription_status')
        .single();
      if (error) {
        console.error('[cai] getSubscriptionStatus error:', error.message);
        return null;
      }
      return data?.subscription_status || 'inactive';
    },

    /** Sign up with email/password */
    async signUp(email, password) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      return data;
    },

    /** Sign in with email/password */
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return data;
    },

    /** Request password reset email */
    async resetPassword(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/paywall.html?mode=reset-confirm'
      });
      if (error) throw new Error(error.message);
    },

    /** Update password (after reset link clicked) */
    async updatePassword(newPassword) {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
    },

    /** Sign out and redirect to index */
    async signOut() {
      await supabase.auth.signOut();
      window.location.href = 'index.html';
    },

    /** Listen for auth state changes */
    onAuthStateChange(callback) {
      return supabase.auth.onAuthStateChange(callback);
    }
  };

  // ---------------------------------------------------------------------------
  // API HELPERS (Edge Function calls)
  // ---------------------------------------------------------------------------
  const api = {
    /**
     * Call the analyze Edge Function (Claude API proxy).
     * @param {object} opts
     * @param {string} opts.type - 'analyze' | 'letter'
     * @param {string} opts.reportText - credit report text (for type='analyze')
     * @param {object} opts.disputeData - dispute info (for type='letter')
     * @param {number} [opts.round] - letter round 1-3 (for type='letter')
     * @param {string} [opts.profileJson] - user profile JSON (for type='letter')
     * @returns {Promise<object>} parsed JSON response
     */
    async analyze(opts) {
      const session = await auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('analyze', {
        body: opts
      });

      if (error) throw new Error(error.message || 'Analyze function failed');
      return data;
    },

    /**
     * Call the mail Edge Function (Mailform API proxy).
     * @param {object} opts
     * @param {string} opts.letterId - ID of the letter record
     * @param {object} opts.from - sender address {name, street, city, state, zip}
     * @param {object} opts.to - recipient address {name, street, city, state, zip}
     * @param {string} opts.content - letter body text
     * @returns {Promise<object>} mailing confirmation with tracking_id
     */
    async mail(opts) {
      const session = await auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('mail', {
        body: opts
      });

      if (error) throw new Error(error.message || 'Mail function failed');
      return data;
    }
  };

  // ---------------------------------------------------------------------------
  // DB HELPERS — thin wrappers around supabase-js for common operations
  // ---------------------------------------------------------------------------
  const db = {
    // --- PROFILES ---
    profiles: {
      async get() {
        const { data, error } = await supabase.from('profiles').select('*').single();
        if (error) throw new Error(error.message);
        return data;
      },
      async update(fields) {
        const { data, error } = await supabase.from('profiles').update(fields).select().single();
        if (error) throw new Error(error.message);
        return data;
      }
    },

    // --- CREDIT REPORTS ---
    reports: {
      async list() {
        const { data, error } = await supabase.from('credit_reports').select('*').order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data;
      },
      async get(id) {
        const { data, error } = await supabase.from('credit_reports').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
      },
      async create(filename, extractedText) {
        const user = await auth.getUser();
        const { data, error } = await supabase.from('credit_reports').insert({
          user_id: user.id, filename, extracted_text: extractedText
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async delete(id) {
        const { error } = await supabase.from('credit_reports').delete().eq('id', id);
        if (error) throw new Error(error.message);
      }
    },

    // --- ANALYSES ---
    analyses: {
      async list() {
        const { data, error } = await supabase.from('analyses').select('*').order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data;
      },
      async get(id) {
        const { data, error } = await supabase.from('analyses').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
      },
      async create(reportId, summary, items) {
        const user = await auth.getUser();
        const { data, error } = await supabase.from('analyses').insert({
          user_id: user.id, credit_report_id: reportId, summary, items
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      }
    },

    // --- DISPUTES ---
    disputes: {
      async list(statusFilter) {
        let query = supabase.from('disputes').select('*').order('created_at', { ascending: false });
        if (statusFilter) query = query.eq('status', statusFilter);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data;
      },
      async get(id) {
        const { data, error } = await supabase.from('disputes').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
      },
      async create(dispute) {
        const user = await auth.getUser();
        const { data, error } = await supabase.from('disputes').insert({
          user_id: user.id, ...dispute
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async update(id, fields) {
        const { data, error } = await supabase.from('disputes').update(fields).eq('id', id).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async delete(id) {
        const { error } = await supabase.from('disputes').delete().eq('id', id);
        if (error) throw new Error(error.message);
      }
    },

    // --- LETTERS ---
    letters: {
      async list() {
        const { data, error } = await supabase.from('letters').select('*').order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data;
      },
      async get(id) {
        const { data, error } = await supabase.from('letters').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
      },
      async create(letter) {
        const user = await auth.getUser();
        const { data, error } = await supabase.from('letters').insert({
          user_id: user.id, ...letter
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async update(id, fields) {
        const { data, error } = await supabase.from('letters').update(fields).eq('id', id).select().single();
        if (error) throw new Error(error.message);
        return data;
      }
    },

    // --- SCORE HISTORY ---
    scores: {
      async list() {
        const { data, error } = await supabase.from('score_history').select('*').order('recorded_at', { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      },
      async add(score) {
        const user = await auth.getUser();
        const { data, error } = await supabase.from('score_history').insert({
          user_id: user.id, score
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async delete(id) {
        const { error } = await supabase.from('score_history').delete().eq('id', id);
        if (error) throw new Error(error.message);
      }
    },

    // --- MAILING ADDRESSES ---
    addresses: {
      async list() {
        const { data, error } = await supabase.from('mailing_addresses').select('*').order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return data;
      },
      async create(address) {
        const user = await auth.getUser();
        const { data, error } = await supabase.from('mailing_addresses').insert({
          user_id: user.id, ...address
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async update(id, fields) {
        const { data, error } = await supabase.from('mailing_addresses').update(fields).eq('id', id).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async delete(id) {
        const { error } = await supabase.from('mailing_addresses').delete().eq('id', id);
        if (error) throw new Error(error.message);
      }
    },

    // --- ASSETS ---
    assets: {
      async list(typeFilter) {
        let query = supabase.from('assets').select('*').order('created_at', { ascending: false });
        if (typeFilter) query = query.eq('type', typeFilter);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data;
      },
      async get(id) {
        const { data, error } = await supabase.from('assets').select('*').eq('id', id).single();
        if (error) throw new Error(error.message);
        return data;
      },
      async create(asset) {
        const user = await auth.getUser();
        const { data, error } = await supabase.from('assets').insert({
          user_id: user.id, ...asset
        }).select().single();
        if (error) throw new Error(error.message);
        return data;
      },
      async delete(id) {
        const { error } = await supabase.from('assets').delete().eq('id', id);
        if (error) throw new Error(error.message);
      },
      /** Get all round bundles for a specific dispute */
      async listByDispute(disputeId) {
        const { data, error } = await supabase.from('assets').select('*')
          .eq('related_dispute_id', disputeId)
          .eq('type', 'round_bundle')
          .order('related_round', { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // STORAGE HELPERS — file upload/download for user documents
  // ---------------------------------------------------------------------------
  const storage = {
    /**
     * Upload a file to the user-documents bucket.
     * Files are stored under the user's ID folder for RLS scoping.
     * @param {File} file - the File object to upload
     * @param {string} subfolder - e.g. 'identity', 'responses'
     * @returns {Promise<{path: string, url: string}>}
     */
    async upload(file, subfolder) {
      const user = await auth.getUser();
      const ext = file.name.split('.').pop() || 'bin';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
      const filePath = `${user.id}/${subfolder}/${fileName}`;

      const { data, error } = await supabase.storage
        .from('user-documents')
        .upload(filePath, file, { contentType: file.type });

      if (error) throw new Error(error.message);

      // Get public/signed URL
      const { data: urlData } = supabase.storage
        .from('user-documents')
        .getPublicUrl(filePath);

      return { path: filePath, url: urlData.publicUrl || filePath };
    },

    /** Delete a file from user-documents bucket */
    async delete(filePath) {
      const { error } = await supabase.storage
        .from('user-documents')
        .remove([filePath]);
      if (error) throw new Error(error.message);
    },

    /** Get a signed URL for private file access (valid 1 hour) */
    async getSignedUrl(filePath) {
      const { data, error } = await supabase.storage
        .from('user-documents')
        .createSignedUrl(filePath, 3600);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    }
  };

  // ---------------------------------------------------------------------------
  // ROUND WORKFLOW HELPERS — manage dispute round progression
  // ---------------------------------------------------------------------------
  const rounds = {
    /**
     * Mark a dispute as sent (starts the 30-day FCRA clock).
     * Called after a letter for the current round is mailed.
     */
    async markSent(disputeId) {
      const now = new Date();
      const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const { data, error } = await supabase.from('disputes').update({
        round_status: 'awaiting_response',
        sent_at: now.toISOString(),
        response_due_date: dueDate.toISOString()
      }).eq('id', disputeId).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    /**
     * Upload a bureau response for the current round.
     * @param {string} disputeId
     * @param {File} file - photo/PDF of bureau response
     * @returns {Promise<{dispute, analysis}>} updated dispute + OCR analysis result
     */
    async uploadResponse(disputeId, file) {
      // 1. Upload file to storage
      const { path, url } = await storage.upload(file, 'responses');

      // 2. Get current dispute state
      const dispute = await db.disputes.get(disputeId);
      const round = dispute.current_round;

      // 3. Send to analyze Edge Function for OCR/vision processing
      const analysis = await api.analyze({
        type: 'analyze_response',
        fileUrl: url,
        filePath: path,
        disputeId: disputeId,
        round: round
      });

      // 4. Update dispute with response data
      const roundPrefix = `round${round}`;
      const updateFields = {
        [`${roundPrefix}_response_text`]: analysis.extracted_text || '',
        [`${roundPrefix}_response_file_url`]: url,
        [`${roundPrefix}_response_confidence`]: analysis.confidence || 0,
        round_status: 'response_received'
      };

      const { data: updated, error } = await supabase.from('disputes')
        .update(updateFields)
        .eq('id', disputeId)
        .select().single();
      if (error) throw new Error(error.message);

      // 5. Create a round_bundle asset for archival
      const user = await auth.getUser();
      await supabase.from('assets').insert({
        user_id: user.id,
        type: 'round_bundle',
        file_url: url,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        related_dispute_id: disputeId,
        related_round: round,
        metadata: {
          response_text: analysis.extracted_text,
          confidence: analysis.confidence,
          uploaded_at: new Date().toISOString()
        }
      });

      return { dispute: updated, analysis };
    },

    /**
     * Complete the current round and advance to the next.
     * If round 3 is completed, marks the dispute as fully complete.
     */
    async completeRound(disputeId) {
      const dispute = await db.disputes.get(disputeId);
      const round = dispute.current_round;

      const roundPrefix = `round${round}`;
      const updateFields = {
        [`${roundPrefix}_completed_at`]: new Date().toISOString()
      };

      if (round < 3) {
        // Advance to next round
        updateFields.current_round = round + 1;
        updateFields.round_status = 'drafted';
        updateFields.response_due_date = null;
        updateFields.sent_at = null;
      } else {
        // Round 3 complete — dispute fully processed
        updateFields.round_status = 'complete';
        updateFields.status = 'resolved';
      }

      const { data, error } = await supabase.from('disputes')
        .update(updateFields)
        .eq('id', disputeId)
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    /**
     * Get days remaining until FCRA deadline for a dispute.
     * Returns negative number if overdue.
     */
    getDaysRemaining(dispute) {
      if (!dispute.response_due_date) return null;
      const due = new Date(dispute.response_due_date);
      const now = new Date();
      return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    },

    /**
     * Check if a dispute's FCRA deadline has passed.
     */
    isOverdue(dispute) {
      const days = this.getDaysRemaining(dispute);
      return days !== null && days < 0;
    }
  };

  // ---------------------------------------------------------------------------
  // EXPOSE ON window.cai
  // ---------------------------------------------------------------------------
  window.cai = window.cai || {};
  window.cai.supabase = supabase;
  window.cai.auth = auth;
  window.cai.api = api;
  window.cai.db = db;
  window.cai.storage = storage;
  window.cai.rounds = rounds;

})();
