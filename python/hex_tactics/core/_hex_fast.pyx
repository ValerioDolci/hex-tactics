# cython: language_level=3, boundscheck=False, wraparound=False
"""Cython accelerator per hot path di hex.py.

Offre versioni C-compiled di:
- hex_distance_c(q1, r1, q2, r2) → int    [funzione pura]
- axial_to_offset_c(q, r) → (col, row)    [funzione pura]
- base_distance_c(q1, r1, q2, r2) → int   [formula chiusa]

NB: queste sono funzioni "primitive" che lavorano su int (non su Axial dataclass).
Il caller può creare adapter Python che convertono Axial → int + delegano qui.
Il vero speedup viene dal fatto che il loop interno è in C nativo.
"""


cpdef int hex_distance_c(int q1, int r1, int q2, int r2):
    """Distanza esagonale in cube coords. C native."""
    cdef int dq = q1 - q2
    cdef int dr = r1 - r2
    cdef int ds = -dq - dr
    cdef int abs_dq = dq if dq >= 0 else -dq
    cdef int abs_dr = dr if dr >= 0 else -dr
    cdef int abs_ds = ds if ds >= 0 else -ds
    return (abs_dq + abs_dr + abs_ds) // 2


cpdef int base_distance_c(int q1, int r1, int q2, int r2):
    """base_distance: max(0, hex_distance - 2). Formula chiusa."""
    cdef int d = hex_distance_c(q1, r1, q2, r2)
    return d - 2 if d > 2 else 0


cpdef tuple axial_to_offset_c(int q, int r):
    """axial → odd-r offset (col, row). C native."""
    cdef int col = q + (r - (r & 1)) // 2
    return (col, r)


cpdef tuple offset_to_axial_c(int col, int row):
    """offset → axial (q, r). C native."""
    cdef int q = col - (row - (row & 1)) // 2
    return (q, row)


cpdef tuple get_base_hexes_qr(int q, int r):
    """7 hex della basetta come tuple di 7 tuple (q, r). C native.

    NEIGHBOR_DIRS axial: (1,0), (1,-1), (0,-1), (-1,0), (-1,1), (0,1)
    Plus center.
    """
    return (
        (q, r),         # center
        (q + 1, r),     # NE-ish
        (q + 1, r - 1),
        (q, r - 1),
        (q - 1, r),
        (q - 1, r + 1),
        (q, r + 1),
    )


cpdef list hexes_in_range_qr(int q, int r, int range_):
    """Lista di tuple (qi, ri) entro `range_` hex. Range<0 → []. C native loops."""
    if range_ < 0:
        return []
    cdef list out = []
    cdef int dq, dr, r_min_inner, r_max_inner
    for dq in range(-range_, range_ + 1):
        # r_min = max(-range_, -dq - range_)
        r_min_inner = -range_ if -range_ > -dq - range_ else -dq - range_
        # r_max = min(range_, -dq + range_)
        r_max_inner = range_ if range_ < -dq + range_ else -dq + range_
        for dr in range(r_min_inner, r_max_inner + 1):
            out.append((q + dq, r + dr))
    return out


cpdef int candidates_filter_count(
    list candidates_qr,
    int unit_q, int unit_r,
    int enemy_q, int enemy_r,
    set blocked_qr,
    set legal_centers_qr,
):
    """Filtra candidate MOVE: count valid (skip current pos, in legal_centers, no blocked overlap).
    Restituisce count solo (per testing)."""
    cdef int count = 0
    cdef int cq, cr
    cdef tuple cand, base_target
    cdef bint overlap
    cdef int i
    for cand in candidates_qr:
        cq = cand[0]
        cr = cand[1]
        if cq == unit_q and cr == unit_r:
            continue
        if (cq, cr) not in legal_centers_qr:
            continue
        # Get 7 base hexes inline
        overlap = False
        if (cq, cr) in blocked_qr: overlap = True
        elif (cq + 1, cr) in blocked_qr: overlap = True
        elif (cq + 1, cr - 1) in blocked_qr: overlap = True
        elif (cq, cr - 1) in blocked_qr: overlap = True
        elif (cq - 1, cr) in blocked_qr: overlap = True
        elif (cq - 1, cr + 1) in blocked_qr: overlap = True
        elif (cq, cr + 1) in blocked_qr: overlap = True
        if overlap:
            continue
        count += 1
    return count


cpdef list filter_move_candidates(
    list candidates_qr,
    int unit_q, int unit_r,
    int enemy_q, int enemy_r,
    set blocked_qr,
    set legal_centers_qr,
):
    """Filter MOVE candidates + compute distance to enemy.
    Returns list of (q, r, base_distance_to_enemy) tuples for valid candidates.
    """
    cdef list valid = []
    cdef int cq, cr, hex_d, base_d
    cdef int dq, dr, ds
    cdef int abs_dq, abs_dr, abs_ds
    cdef tuple cand
    cdef bint overlap
    for cand in candidates_qr:
        cq = cand[0]
        cr = cand[1]
        if cq == unit_q and cr == unit_r:
            continue
        if (cq, cr) not in legal_centers_qr:
            continue
        # 7-hex base overlap check
        overlap = False
        if (cq, cr) in blocked_qr: overlap = True
        elif (cq + 1, cr) in blocked_qr: overlap = True
        elif (cq + 1, cr - 1) in blocked_qr: overlap = True
        elif (cq, cr - 1) in blocked_qr: overlap = True
        elif (cq - 1, cr) in blocked_qr: overlap = True
        elif (cq - 1, cr + 1) in blocked_qr: overlap = True
        elif (cq, cr + 1) in blocked_qr: overlap = True
        if overlap:
            continue
        # base_distance(candidate, enemy) inline
        dq = cq - enemy_q
        dr = cr - enemy_r
        ds = -dq - dr
        abs_dq = dq if dq >= 0 else -dq
        abs_dr = dr if dr >= 0 else -dr
        abs_ds = ds if ds >= 0 else -ds
        hex_d = (abs_dq + abs_dr + abs_ds) // 2
        base_d = hex_d - 2 if hex_d > 2 else 0
        valid.append((cq, cr, base_d))
    return valid
