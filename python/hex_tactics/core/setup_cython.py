"""Build script per Cython hot path. Run:
    cd python/hex_tactics/core
    python setup_cython.py build_ext --inplace
"""
from setuptools import setup
from Cython.Build import cythonize

setup(
    name="_hex_fast",
    ext_modules=cythonize(
        ["_hex_fast.pyx"],
        compiler_directives={
            "language_level": "3",
            "boundscheck": False,
            "wraparound": False,
            "cdivision": True,
        },
    ),
    zip_safe=False,
)
