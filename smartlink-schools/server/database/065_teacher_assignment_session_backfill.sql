USE smartlink_schools;

/* Runtime authorization now requires an exact academic-year and term match.
   Preserve legacy assignments only where their session can be determined
   without treating NULL as a permanent wildcard. */

/* A valid term always determines its academic year. */
UPDATE teacher_class_subject_assignments assignment
JOIN terms term
  ON term.id=assignment.term_id
 AND term.school_id=assignment.school_id
SET assignment.academic_year_id=term.academic_year_id
WHERE assignment.term_id IS NOT NULL
  AND assignment.academic_year_id IS NULL;

/* Prefer the legacy display labels when both labels resolve uniquely inside
   the same school. This keeps historical assignments attached to their
   original term without allowing duplicate display labels to choose a term
   nondeterministically. */
UPDATE teacher_class_subject_assignments assignment
JOIN (
  SELECT academic_year.school_id,
         LOWER(TRIM(academic_year.name)) academic_year_label,
         LOWER(TRIM(term.name)) term_label,
         MAX(academic_year.id) academic_year_id,
         MAX(term.id) term_id
  FROM academic_years academic_year
  JOIN terms term
    ON term.school_id=academic_year.school_id
   AND term.academic_year_id=academic_year.id
  GROUP BY academic_year.school_id,
           LOWER(TRIM(academic_year.name)),
           LOWER(TRIM(term.name))
  HAVING COUNT(DISTINCT academic_year.id)=1
     AND COUNT(DISTINCT term.id)=1
) resolved_session
  ON resolved_session.school_id=assignment.school_id
 AND resolved_session.academic_year_label=LOWER(TRIM(assignment.academic_year))
 AND resolved_session.term_label=LOWER(TRIM(assignment.term))
SET assignment.academic_year_id=resolved_session.academic_year_id,
    assignment.term_id=resolved_session.term_id
WHERE (assignment.academic_year_id IS NULL OR assignment.term_id IS NULL)
  AND (assignment.academic_year_id IS NULL OR assignment.academic_year_id=resolved_session.academic_year_id)
  AND (assignment.term_id IS NULL OR assignment.term_id=resolved_session.term_id);

/* Some old assignments were saved without either label. Backfill those only
   when the school has exactly one active academic year and exactly one open or
   marking term, so the migration cannot guess between two sessions. */
UPDATE teacher_class_subject_assignments assignment
JOIN (
  SELECT active_year.school_id,
         active_year.academic_year_id,
         MAX(term.id) term_id
  FROM (
    SELECT school_id, MAX(id) academic_year_id
    FROM academic_years
    WHERE is_active=1
      AND status<>'archived'
    GROUP BY school_id
    HAVING COUNT(DISTINCT id)=1
  ) active_year
  JOIN terms term
    ON term.school_id=active_year.school_id
   AND term.academic_year_id=active_year.academic_year_id
   AND term.status IN ('open','marking')
  GROUP BY active_year.school_id,active_year.academic_year_id
  HAVING COUNT(DISTINCT term.id)=1
) active_session
  ON active_session.school_id=assignment.school_id
SET assignment.academic_year_id=active_session.academic_year_id,
    assignment.term_id=active_session.term_id
WHERE assignment.is_active=1
  AND assignment.academic_year_id IS NULL
  AND assignment.term_id IS NULL
  AND TRIM(COALESCE(assignment.academic_year,''))=''
  AND TRIM(COALESCE(assignment.term,''))='';

/* Rows left NULL were ambiguous and deliberately remain unauthorized until an
   administrator assigns them to an explicit session. */
