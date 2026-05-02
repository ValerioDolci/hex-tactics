// AUTO-GENERATED — DO NOT EDIT BY HAND
// Generato da python/scripts/distill_full.py
// Albero: depth=26, leaves=500, classes=[np.int32(0), np.int32(1), np.int32(2), np.int32(3), np.int32(4), np.int32(5), np.int32(6), np.int32(7), np.int32(8), np.int32(9)]

/**
 * Predict action_id (0..19) data una observation di 153 feature.
 * L'albero è stato distillato dal modello v14 MaskablePPO.
 */
export function predictDtAction(obs: Float32Array | number[]): number {
  if (obs[76] <= 0.500000) {
    if (obs[64] <= 0.500000) {
      if (obs[132] <= 0.100000) {
        if (obs[2] <= 0.183333) {
          if (obs[3] <= 0.166667) {
            if (obs[63] <= 0.500000) {
              if (obs[3] <= 0.055556) {
                if (obs[145] <= 0.016667) {
                  return 0;
                } else {
                  return 1;
                }
              } else {
                if (obs[138] <= 0.500000) {
                  if (obs[7] <= 0.016667) {
                    if (obs[2] <= -0.583333) {
                      return 0;
                    } else {
                      return 2;
                    }
                  } else {
                    if (obs[52] <= 1.250000) {
                      return 2;
                    } else {
                      return 3;
                    }
                  }
                } else {
                  if (obs[1] <= 0.050000) {
                    return 0;
                  } else {
                    return 2;
                  }
                }
              }
            } else {
              if (obs[2] <= -2.650000) {
                return 1;
              } else {
                if (obs[25] <= 0.500000) {
                  return 2;
                } else {
                  return 0;
                }
              }
            }
          } else {
            if (obs[66] <= 0.500000) {
              if (obs[126] <= 0.500000) {
                if (obs[2] <= 0.083333) {
                  if (obs[149] <= 0.500000) {
                    if (obs[101] <= 0.500000) {
                      if (obs[135] <= 0.075000) {
                        if (obs[2] <= -1.183333) {
                          return 0;
                        } else {
                          if (obs[144] <= 0.150000) {
                            return 2;
                          } else {
                            return 1;
                          }
                        }
                      } else {
                        return 0;
                      }
                    } else {
                      if (obs[122] <= 0.250000) {
                        return 2;
                      } else {
                        return 1;
                      }
                    }
                  } else {
                    return 0;
                  }
                } else {
                  if (obs[7] <= -0.683333) {
                    return 0;
                  } else {
                    return 2;
                  }
                }
              } else {
                if (obs[1] <= 0.016667) {
                  return 0;
                } else {
                  return 1;
                }
              }
            } else {
              if (obs[26] <= 0.500000) {
                if (obs[25] <= 0.500000) {
                  if (obs[24] <= 0.500000) {
                    if (obs[23] <= 0.500000) {
                      if (obs[115] <= 0.500000) {
                        if (obs[2] <= -0.150000) {
                          return 2;
                        } else {
                          return 2;
                        }
                      } else {
                        if (obs[12] <= 0.500000) {
                          return 4;
                        } else {
                          return 4;
                        }
                      }
                    } else {
                      if (obs[2] <= -0.816667) {
                        return 0;
                      } else {
                        return 6;
                      }
                    }
                  } else {
                    if (obs[2] <= -0.983333) {
                      return 0;
                    } else {
                      if (obs[21] <= 0.500000) {
                        if (obs[20] <= 0.500000) {
                          if (obs[19] <= 0.500000) {
                            return 6;
                          } else {
                            return 4;
                          }
                        } else {
                          return 3;
                        }
                      } else {
                        return 3;
                      }
                    }
                  }
                } else {
                  if (obs[21] <= 0.500000) {
                    if (obs[2] <= -2.833333) {
                      return 0;
                    } else {
                      if (obs[7] <= -1.716667) {
                        return 6;
                      } else {
                        if (obs[20] <= 0.500000) {
                          if (obs[19] <= 0.500000) {
                            return 6;
                          } else {
                            return 4;
                          }
                        } else {
                          return 4;
                        }
                      }
                    }
                  } else {
                    return 2;
                  }
                }
              } else {
                if (obs[17] <= 0.500000) {
                  if (obs[20] <= 0.500000) {
                    if (obs[21] <= 0.500000) {
                      if (obs[19] <= 0.500000) {
                        if (obs[2] <= -0.850000) {
                          return 5;
                        } else {
                          return 6;
                        }
                      } else {
                        return 4;
                      }
                    } else {
                      return 4;
                    }
                  } else {
                    return 4;
                  }
                } else {
                  return 6;
                }
              }
            }
          }
        } else {
          if (obs[63] <= 0.500000) {
            if (obs[72] <= 0.500000) {
              if (obs[147] <= 1.500000) {
                if (obs[1] <= 0.016667) {
                  return 0;
                } else {
                  if (obs[131] <= 0.500000) {
                    if (obs[116] <= 0.500000) {
                      if (obs[120] <= 0.800000) {
                        if (obs[145] <= 0.016667) {
                          return 0;
                        } else {
                          return 0;
                        }
                      } else {
                        return 0;
                      }
                    } else {
                      return 3;
                    }
                  } else {
                    if (obs[59] <= 0.125000) {
                      return 1;
                    } else {
                      return 1;
                    }
                  }
                }
              } else {
                if (obs[59] <= 0.175000) {
                  return 1;
                } else {
                  return 1;
                }
              }
            } else {
              if (obs[149] <= 0.500000) {
                if (obs[25] <= 0.500000) {
                  if (obs[26] <= 0.500000) {
                    if (obs[24] <= 0.500000) {
                      if (obs[23] <= 0.500000) {
                        if (obs[21] <= 0.500000) {
                          if (obs[19] <= 0.500000) {
                            if (obs[20] <= 0.500000) {
                              if (obs[3] <= 0.166667) {
                                return 2;
                              } else {
                                if (obs[12] <= 0.500000) {
                                  if (obs[121] <= 0.500000) {
                                    if (obs[2] <= 0.550000) {
                                      if (obs[90] <= 0.500000) {
                                        if (obs[38] <= 0.500000) {
                                          if (obs[120] <= 0.300000) {
                                            return 2;
                                          } else {
                                            return 4;
                                          }
                                        } else {
                                          return 4;
                                        }
                                      } else {
                                        return 2;
                                      }
                                    } else {
                                      if (obs[13] <= 0.500000) {
                                        if (obs[17] <= 0.500000) {
                                          if (obs[90] <= 0.500000) {
                                            if (obs[7] <= -6.533333) {
                                              return 0;
                                            } else {
                                              return 4;
                                            }
                                          } else {
                                            return 4;
                                          }
                                        } else {
                                          return 4;
                                        }
                                      } else {
                                        return 4;
                                      }
                                    }
                                  } else {
                                    return 4;
                                  }
                                } else {
                                  return 4;
                                }
                              }
                            } else {
                              return 2;
                            }
                          } else {
                            return 2;
                          }
                        } else {
                          return 2;
                        }
                      } else {
                        if (obs[19] <= 0.500000) {
                          if (obs[21] <= 0.500000) {
                            if (obs[3] <= 0.166667) {
                              return 2;
                            } else {
                              if (obs[20] <= 0.500000) {
                                if (obs[85] <= 0.500000) {
                                  if (obs[12] <= 0.500000) {
                                    return 6;
                                  } else {
                                    return 6;
                                  }
                                } else {
                                  return 6;
                                }
                              } else {
                                return 4;
                              }
                            }
                          } else {
                            return 4;
                          }
                        } else {
                          return 4;
                        }
                      }
                    } else {
                      if (obs[21] <= 0.500000) {
                        if (obs[19] <= 0.500000) {
                          if (obs[3] <= 0.166667) {
                            return 2;
                          } else {
                            if (obs[20] <= 0.500000) {
                              return 6;
                            } else {
                              return 4;
                            }
                          }
                        } else {
                          return 4;
                        }
                      } else {
                        return 3;
                      }
                    }
                  } else {
                    if (obs[13] <= 0.500000) {
                      if (obs[17] <= 0.500000) {
                        if (obs[15] <= 0.500000) {
                          if (obs[3] <= 0.166667) {
                            return 2;
                          } else {
                            if (obs[102] <= 0.500000) {
                              if (obs[18] <= 0.500000) {
                                if (obs[14] <= 0.500000) {
                                  if (obs[16] <= 0.500000) {
                                    if (obs[11] <= 0.500000) {
                                      return 4;
                                    } else {
                                      return 4;
                                    }
                                  } else {
                                    return 6;
                                  }
                                } else {
                                  return 6;
                                }
                              } else {
                                return 6;
                              }
                            } else {
                              if (obs[19] <= 0.500000) {
                                if (obs[49] <= 0.500000) {
                                  if (obs[108] <= 1.900000) {
                                    return 4;
                                  } else {
                                    return 6;
                                  }
                                } else {
                                  return 6;
                                }
                              } else {
                                return 4;
                              }
                            }
                          }
                        } else {
                          return 6;
                        }
                      } else {
                        return 6;
                      }
                    } else {
                      if (obs[85] <= 0.500000) {
                        return 6;
                      } else {
                        return 4;
                      }
                    }
                  }
                } else {
                  if (obs[21] <= 0.500000) {
                    if (obs[19] <= 0.500000) {
                      if (obs[20] <= 0.500000) {
                        return 6;
                      } else {
                        return 4;
                      }
                    } else {
                      return 4;
                    }
                  } else {
                    return 4;
                  }
                }
              } else {
                if (obs[21] <= 0.500000) {
                  if (obs[3] <= 0.166667) {
                    return 2;
                  } else {
                    if (obs[19] <= 0.500000) {
                      if (obs[20] <= 0.500000) {
                        if (obs[85] <= 0.500000) {
                          return 6;
                        } else {
                          if (obs[7] <= -1.183333) {
                            return 4;
                          } else {
                            return 6;
                          }
                        }
                      } else {
                        return 4;
                      }
                    } else {
                      return 4;
                    }
                  }
                } else {
                  return 4;
                }
              }
            }
          } else {
            if (obs[71] <= 0.150000) {
              if (obs[62] <= 0.500000) {
                if (obs[36] <= 0.500000) {
                  if (obs[19] <= 0.500000) {
                    if (obs[20] <= 0.500000) {
                      if (obs[17] <= 0.500000) {
                        if (obs[16] <= 0.500000) {
                          if (obs[42] <= 0.500000) {
                            if (obs[46] <= 0.500000) {
                              if (obs[49] <= 0.500000) {
                                if (obs[55] <= 0.375000) {
                                  if (obs[25] <= 0.500000) {
                                    if (obs[23] <= 0.500000) {
                                      return 5;
                                    } else {
                                      return 5;
                                    }
                                  } else {
                                    return 5;
                                  }
                                } else {
                                  return 5;
                                }
                              } else {
                                if (obs[39] <= 0.500000) {
                                  if (obs[29] <= 0.500000) {
                                    return 5;
                                  } else {
                                    return 5;
                                  }
                                } else {
                                  return 5;
                                }
                              }
                            } else {
                              return 5;
                            }
                          } else {
                            return 4;
                          }
                        } else {
                          if (obs[46] <= 0.500000) {
                            if (obs[39] <= 0.500000) {
                              if (obs[24] <= 0.500000) {
                                return 4;
                              } else {
                                return 3;
                              }
                            } else {
                              return 5;
                            }
                          } else {
                            return 5;
                          }
                        }
                      } else {
                        if (obs[46] <= 0.500000) {
                          return 4;
                        } else {
                          return 5;
                        }
                      }
                    } else {
                      if (obs[150] <= 0.500000) {
                        return 4;
                      } else {
                        return 5;
                      }
                    }
                  } else {
                    if (obs[46] <= 0.500000) {
                      if (obs[39] <= 0.500000) {
                        return 4;
                      } else {
                        return 5;
                      }
                    } else {
                      return 5;
                    }
                  }
                } else {
                  if (obs[46] <= 0.500000) {
                    return 4;
                  } else {
                    return 5;
                  }
                }
              } else {
                if (obs[24] <= 0.500000) {
                  if (obs[8] <= 0.888889) {
                    return 4;
                  } else {
                    if (obs[150] <= 0.500000) {
                      return 4;
                    } else {
                      return 4;
                    }
                  }
                } else {
                  return 2;
                }
              }
            } else {
              if (obs[7] <= -2.383333) {
                return 4;
              } else {
                if (obs[120] <= 0.300000) {
                  if (obs[149] <= 0.500000) {
                    if (obs[135] <= 0.025000) {
                      return 4;
                    } else {
                      return 2;
                    }
                  } else {
                    return 3;
                  }
                } else {
                  if (obs[24] <= 0.500000) {
                    if (obs[150] <= 0.500000) {
                      return 4;
                    } else {
                      if (obs[39] <= 0.500000) {
                        return 4;
                      } else {
                        return 4;
                      }
                    }
                  } else {
                    if (obs[149] <= 0.500000) {
                      return 4;
                    } else {
                      return 3;
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        if (obs[103] <= 0.500000) {
          if (obs[2] <= 0.083333) {
            if (obs[2] <= -0.816667) {
              if (obs[149] <= 0.500000) {
                if (obs[135] <= 0.025000) {
                  return 2;
                } else {
                  return 2;
                }
              } else {
                return 0;
              }
            } else {
              if (obs[135] <= 0.025000) {
                if (obs[101] <= 0.500000) {
                  return 2;
                } else {
                  return 2;
                }
              } else {
                if (obs[98] <= 0.025000) {
                  if (obs[76] <= -0.500000) {
                    return 2;
                  } else {
                    return 2;
                  }
                } else {
                  return 1;
                }
              }
            }
          } else {
            if (obs[140] <= 0.750000) {
              if (obs[129] <= 0.500000) {
                if (obs[84] <= 0.300000) {
                  if (obs[108] <= 0.100000) {
                    if (obs[38] <= 0.500000) {
                      return 2;
                    } else {
                      return 2;
                    }
                  } else {
                    if (obs[46] <= 0.500000) {
                      if (obs[76] <= -0.500000) {
                        if (obs[26] <= 0.500000) {
                          if (obs[23] <= 0.500000) {
                            return 2;
                          } else {
                            return 6;
                          }
                        } else {
                          return 6;
                        }
                      } else {
                        if (obs[32] <= 0.500000) {
                          if (obs[39] <= 0.500000) {
                            if (obs[98] <= 0.025000) {
                              if (obs[7] <= -1.500000) {
                                return 2;
                              } else {
                                if (obs[23] <= 0.500000) {
                                  return 3;
                                } else {
                                  return 2;
                                }
                              }
                            } else {
                              return 2;
                            }
                          } else {
                            return 2;
                          }
                        } else {
                          return 2;
                        }
                      }
                    } else {
                      return 2;
                    }
                  }
                } else {
                  if (obs[90] <= 0.500000) {
                    if (obs[76] <= -0.500000) {
                      return 6;
                    } else {
                      if (obs[98] <= 0.325000) {
                        if (obs[26] <= 0.500000) {
                          return 2;
                        } else {
                          return 2;
                        }
                      } else {
                        return 2;
                      }
                    }
                  } else {
                    if (obs[96] <= 1.900000) {
                      if (obs[151] <= 0.450000) {
                        return 2;
                      } else {
                        return 2;
                      }
                    } else {
                      return 3;
                    }
                  }
                }
              } else {
                if (obs[19] <= 0.500000) {
                  if (obs[20] <= 0.500000) {
                    if (obs[135] <= 0.025000) {
                      if (obs[71] <= 2.450000) {
                        return 2;
                      } else {
                        return 0;
                      }
                    } else {
                      if (obs[5] <= 0.425000) {
                        return 1;
                      } else {
                        return 2;
                      }
                    }
                  } else {
                    return 4;
                  }
                } else {
                  if (obs[0] <= 0.975000) {
                    return 2;
                  } else {
                    return 4;
                  }
                }
              }
            } else {
              return 1;
            }
          }
        } else {
          if (obs[2] <= -0.316667) {
            if (obs[2] <= -1.116667) {
              return 2;
            } else {
              return 2;
            }
          } else {
            if (obs[63] <= 0.500000) {
              if (obs[26] <= 0.500000) {
                return 2;
              } else {
                if (obs[66] <= 0.500000) {
                  return 2;
                } else {
                  return 6;
                }
              }
            } else {
              if (obs[7] <= -3.150000) {
                return 2;
              } else {
                if (obs[135] <= 0.125000) {
                  if (obs[96] <= 2.300000) {
                    return 2;
                  } else {
                    return 2;
                  }
                } else {
                  if (obs[110] <= 0.025000) {
                    return 2;
                  } else {
                    return 2;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      if (obs[1] <= 0.016667) {
        if (obs[125] <= 0.500000) {
          if (obs[113] <= 0.500000) {
            if (obs[132] <= 0.100000) {
              if (obs[120] <= 0.100000) {
                if (obs[59] <= 0.075000) {
                  if (obs[2] <= 0.333333) {
                    if (obs[38] <= 0.500000) {
                      return 1;
                    } else {
                      return 1;
                    }
                  } else {
                    return 0;
                  }
                } else {
                  return 0;
                }
              } else {
                if (obs[149] <= 0.500000) {
                  if (obs[24] <= 0.500000) {
                    if (obs[6] <= 0.150000) {
                      return 0;
                    } else {
                      if (obs[59] <= 0.075000) {
                        return 0;
                      } else {
                        return 0;
                      }
                    }
                  } else {
                    return 0;
                  }
                } else {
                  if (obs[7] <= -0.916667) {
                    return 0;
                  } else {
                    if (obs[99] <= 0.025000) {
                      if (obs[23] <= 0.500000) {
                        return 1;
                      } else {
                        return 0;
                      }
                    } else {
                      return 0;
                    }
                  }
                }
              }
            } else {
              if (obs[24] <= 0.500000) {
                if (obs[25] <= 0.500000) {
                  if (obs[23] <= 0.500000) {
                    return 0;
                  } else {
                    if (obs[122] <= 0.275000) {
                      if (obs[126] <= 0.500000) {
                        return 0;
                      } else {
                        if (obs[5] <= 0.475000) {
                          if (obs[7] <= -0.283333) {
                            return 0;
                          } else {
                            return 1;
                          }
                        } else {
                          return 0;
                        }
                      }
                    } else {
                      return 1;
                    }
                  }
                } else {
                  if (obs[121] <= 0.500000) {
                    if (obs[126] <= 0.500000) {
                      return 0;
                    } else {
                      return 0;
                    }
                  } else {
                    return 1;
                  }
                }
              } else {
                if (obs[126] <= 0.500000) {
                  return 0;
                } else {
                  if (obs[5] <= 0.575000) {
                    if (obs[8] <= 0.611111) {
                      return 0;
                    } else {
                      return 1;
                    }
                  } else {
                    return 0;
                  }
                }
              }
            }
          } else {
            if (obs[62] <= 0.500000) {
              if (obs[52] <= 0.850000) {
                return 0;
              } else {
                if (obs[90] <= 0.500000) {
                  return 0;
                } else {
                  if (obs[7] <= 0.416667) {
                    return 0;
                  } else {
                    return 1;
                  }
                }
              }
            } else {
              if (obs[126] <= 0.500000) {
                if (obs[106] <= 0.500000) {
                  if (obs[8] <= 0.611111) {
                    if (obs[2] <= -1.816667) {
                      return 0;
                    } else {
                      return 0;
                    }
                  } else {
                    return 1;
                  }
                } else {
                  if (obs[111] <= 0.025000) {
                    if (obs[127] <= 0.500000) {
                      return 0;
                    } else {
                      if (obs[12] <= 0.500000) {
                        if (obs[150] <= 0.500000) {
                          if (obs[17] <= 0.500000) {
                            return 5;
                          } else {
                            return 0;
                          }
                        } else {
                          return 5;
                        }
                      } else {
                        return 5;
                      }
                    }
                  } else {
                    if (obs[2] <= -0.283333) {
                      return 2;
                    } else {
                      return 4;
                    }
                  }
                }
              } else {
                if (obs[132] <= 0.500000) {
                  if (obs[7] <= -0.083333) {
                    return 0;
                  } else {
                    if (obs[2] <= -0.650000) {
                      if (obs[3] <= 0.944444) {
                        if (obs[59] <= 0.075000) {
                          return 1;
                        } else {
                          return 0;
                        }
                      } else {
                        return 1;
                      }
                    } else {
                      if (obs[106] <= 0.500000) {
                        return 0;
                      } else {
                        return 0;
                      }
                    }
                  }
                } else {
                  if (obs[59] <= 0.075000) {
                    if (obs[71] <= 1.450000) {
                      return 1;
                    } else {
                      return 0;
                    }
                  } else {
                    if (obs[16] <= 0.500000) {
                      if (obs[80] <= 0.500000) {
                        if (obs[20] <= 0.500000) {
                          return 0;
                        } else {
                          return 1;
                        }
                      } else {
                        return 1;
                      }
                    } else {
                      return 1;
                    }
                  }
                }
              }
            }
          }
        } else {
          if (obs[98] <= 0.025000) {
            if (obs[7] <= -4.583333) {
              return 6;
            } else {
              if (obs[2] <= -0.883333) {
                if (obs[89] <= 0.500000) {
                  if (obs[7] <= -1.250000) {
                    return 0;
                  } else {
                    if (obs[71] <= 1.350000) {
                      return 0;
                    } else {
                      return 1;
                    }
                  }
                } else {
                  if (obs[61] <= 0.500000) {
                    return 1;
                  } else {
                    if (obs[6] <= 0.116667) {
                      if (obs[2] <= -4.133333) {
                        return 8;
                      } else {
                        return 0;
                      }
                    } else {
                      return 8;
                    }
                  }
                }
              } else {
                if (obs[13] <= 0.500000) {
                  if (obs[15] <= 0.500000) {
                    if (obs[46] <= 0.500000) {
                      if (obs[107] <= 0.500000) {
                        if (obs[17] <= 0.500000) {
                          if (obs[59] <= 1.150000) {
                            if (obs[150] <= 0.500000) {
                              if (obs[11] <= 0.500000) {
                                return 1;
                              } else {
                                return 0;
                              }
                            } else {
                              return 5;
                            }
                          } else {
                            return 3;
                          }
                        } else {
                          return 0;
                        }
                      } else {
                        if (obs[2] <= 0.283333) {
                          if (obs[7] <= 0.316667) {
                            return 0;
                          } else {
                            return 1;
                          }
                        } else {
                          return 1;
                        }
                      }
                    } else {
                      return 0;
                    }
                  } else {
                    return 0;
                  }
                } else {
                  return 0;
                }
              }
            }
          } else {
            if (obs[2] <= -0.483333) {
              return 1;
            } else {
              return 1;
            }
          }
        }
      } else {
        if (obs[5] <= 0.025000) {
          if (obs[92] <= 0.500000) {
            return 0;
          } else {
            if (obs[2] <= 0.483333) {
              return 0;
            } else {
              return 1;
            }
          }
        } else {
          if (obs[127] <= 0.500000) {
            if (obs[95] <= 0.500000) {
              if (obs[59] <= 0.275000) {
                if (obs[128] <= 0.500000) {
                  if (obs[46] <= 0.500000) {
                    if (obs[13] <= 0.500000) {
                      if (obs[17] <= 0.500000) {
                        if (obs[11] <= 0.500000) {
                          if (obs[15] <= 0.500000) {
                            if (obs[2] <= -0.050000) {
                              if (obs[107] <= 0.500000) {
                                if (obs[83] <= 0.500000) {
                                  return 1;
                                } else {
                                  return 1;
                                }
                              } else {
                                if (obs[86] <= 0.375000) {
                                  return 1;
                                } else {
                                  return 1;
                                }
                              }
                            } else {
                              if (obs[108] <= 0.100000) {
                                if (obs[150] <= 0.500000) {
                                  if (obs[12] <= 0.500000) {
                                    if (obs[4] <= 0.500000) {
                                      if (obs[7] <= -1.566667) {
                                        return 9;
                                      } else {
                                        if (obs[123] <= 0.125000) {
                                          return 1;
                                        } else {
                                          return 0;
                                        }
                                      }
                                    } else {
                                      if (obs[133] <= 0.500000) {
                                        if (obs[6] <= 0.416667) {
                                          return 1;
                                        } else {
                                          return 1;
                                        }
                                      } else {
                                        return 4;
                                      }
                                    }
                                  } else {
                                    if (obs[59] <= 0.225000) {
                                      if (obs[121] <= 0.500000) {
                                        return 1;
                                      } else {
                                        if (obs[52] <= 1.050000) {
                                          return 1;
                                        } else {
                                          return 0;
                                        }
                                      }
                                    } else {
                                      return 5;
                                    }
                                  }
                                } else {
                                  if (obs[59] <= 0.225000) {
                                    if (obs[123] <= 0.075000) {
                                      return 1;
                                    } else {
                                      return 1;
                                    }
                                  } else {
                                    return 5;
                                  }
                                }
                              } else {
                                if (obs[107] <= 0.500000) {
                                  if (obs[132] <= 0.100000) {
                                    if (obs[59] <= 0.075000) {
                                      if (obs[6] <= 0.283333) {
                                        return 1;
                                      } else {
                                        return 3;
                                      }
                                    } else {
                                      return 0;
                                    }
                                  } else {
                                    if (obs[119] <= 0.500000) {
                                      if (obs[5] <= 0.725000) {
                                        if (obs[79] <= 0.500000) {
                                          if (obs[83] <= 0.500000) {
                                            return 1;
                                          } else {
                                            return 1;
                                          }
                                        } else {
                                          return 0;
                                        }
                                      } else {
                                        if (obs[82] <= 0.500000) {
                                          if (obs[27] <= 0.500000) {
                                            return 1;
                                          } else {
                                            return 1;
                                          }
                                        } else {
                                          return 0;
                                        }
                                      }
                                    } else {
                                      return 1;
                                    }
                                  }
                                } else {
                                  return 0;
                                }
                              }
                            }
                          } else {
                            if (obs[98] <= 0.025000) {
                              if (obs[114] <= 0.500000) {
                                if (obs[27] <= 0.500000) {
                                  if (obs[78] <= 0.500000) {
                                    if (obs[123] <= 0.075000) {
                                      return 1;
                                    } else {
                                      return 0;
                                    }
                                  } else {
                                    return 1;
                                  }
                                } else {
                                  return 0;
                                }
                              } else {
                                return 0;
                              }
                            } else {
                              return 1;
                            }
                          }
                        } else {
                          if (obs[114] <= 0.500000) {
                            if (obs[98] <= 0.025000) {
                              if (obs[83] <= 0.500000) {
                                if (obs[32] <= 0.500000) {
                                  if (obs[6] <= 0.083333) {
                                    if (obs[150] <= 0.500000) {
                                      if (obs[2] <= 0.316667) {
                                        return 1;
                                      } else {
                                        if (obs[123] <= 0.075000) {
                                          return 1;
                                        } else {
                                          return 1;
                                        }
                                      }
                                    } else {
                                      return 1;
                                    }
                                  } else {
                                    return 1;
                                  }
                                } else {
                                  return 1;
                                }
                              } else {
                                return 0;
                              }
                            } else {
                              return 1;
                            }
                          } else {
                            if (obs[103] <= 0.500000) {
                              if (obs[98] <= 0.025000) {
                                if (obs[78] <= 0.500000) {
                                  return 0;
                                } else {
                                  return 0;
                                }
                              } else {
                                return 1;
                              }
                            } else {
                              return 0;
                            }
                          }
                        }
                      } else {
                        if (obs[114] <= 0.500000) {
                          if (obs[98] <= 0.025000) {
                            if (obs[152] <= 0.150000) {
                              if (obs[2] <= 0.716667) {
                                if (obs[150] <= 0.500000) {
                                  if (obs[102] <= 0.500000) {
                                    if (obs[115] <= 0.500000) {
                                      return 1;
                                    } else {
                                      return 0;
                                    }
                                  } else {
                                    return 1;
                                  }
                                } else {
                                  return 6;
                                }
                              } else {
                                return 1;
                              }
                            } else {
                              if (obs[3] <= 0.944444) {
                                return 1;
                              } else {
                                return 1;
                              }
                            }
                          } else {
                            return 1;
                          }
                        } else {
                          if (obs[120] <= 0.900000) {
                            if (obs[7] <= -0.483333) {
                              return 0;
                            } else {
                              return 0;
                            }
                          } else {
                            return 0;
                          }
                        }
                      }
                    } else {
                      if (obs[98] <= 0.025000) {
                        if (obs[114] <= 0.500000) {
                          if (obs[2] <= 0.250000) {
                            return 0;
                          } else {
                            if (obs[83] <= 0.500000) {
                              if (obs[123] <= 0.025000) {
                                if (obs[5] <= 0.475000) {
                                  return 1;
                                } else {
                                  if (obs[27] <= 0.500000) {
                                    if (obs[150] <= 0.500000) {
                                      return 1;
                                    } else {
                                      return 0;
                                    }
                                  } else {
                                    if (obs[7] <= -0.533333) {
                                      return 1;
                                    } else {
                                      if (obs[96] <= 1.700000) {
                                        if (obs[119] <= 0.500000) {
                                          return 0;
                                        } else {
                                          return 1;
                                        }
                                      } else {
                                        return 1;
                                      }
                                    }
                                  }
                                }
                              } else {
                                return 0;
                              }
                            } else {
                              return 0;
                            }
                          }
                        } else {
                          if (obs[2] <= -0.150000) {
                            if (obs[101] <= 0.500000) {
                              return 1;
                            } else {
                              return 6;
                            }
                          } else {
                            if (obs[7] <= 0.183333) {
                              return 0;
                            } else {
                              if (obs[78] <= 0.500000) {
                                return 0;
                              } else {
                                return 1;
                              }
                            }
                          }
                        }
                      } else {
                        return 1;
                      }
                    }
                  } else {
                    if (obs[17] <= 0.500000) {
                      if (obs[98] <= 0.025000) {
                        if (obs[132] <= 0.700000) {
                          if (obs[5] <= 0.475000) {
                            if (obs[89] <= 0.500000) {
                              if (obs[71] <= 1.750000) {
                                if (obs[108] <= 0.100000) {
                                  if (obs[0] <= 0.875000) {
                                    return 1;
                                  } else {
                                    return 1;
                                  }
                                } else {
                                  return 1;
                                }
                              } else {
                                return 0;
                              }
                            } else {
                              if (obs[7] <= -12.716667) {
                                return 6;
                              } else {
                                return 0;
                              }
                            }
                          } else {
                            if (obs[126] <= 0.500000) {
                              if (obs[150] <= 0.500000) {
                                if (obs[2] <= 0.750000) {
                                  if (obs[108] <= 0.100000) {
                                    return 0;
                                  } else {
                                    return 1;
                                  }
                                } else {
                                  if (obs[0] <= 0.875000) {
                                    return 0;
                                  } else {
                                    if (obs[3] <= 0.944444) {
                                      return 1;
                                    } else {
                                      return 1;
                                    }
                                  }
                                }
                              } else {
                                if (obs[71] <= 0.250000) {
                                  return 5;
                                } else {
                                  if (obs[90] <= 0.500000) {
                                    return 7;
                                  } else {
                                    return 0;
                                  }
                                }
                              }
                            } else {
                              if (obs[8] <= 0.500000) {
                                return 0;
                              } else {
                                if (obs[116] <= 0.500000) {
                                  return 0;
                                } else {
                                  return 4;
                                }
                              }
                            }
                          }
                        } else {
                          if (obs[11] <= 0.500000) {
                            if (obs[7] <= -3.583333) {
                              return 6;
                            } else {
                              if (obs[15] <= 0.500000) {
                                if (obs[13] <= 0.500000) {
                                  return 1;
                                } else {
                                  return 0;
                                }
                              } else {
                                return 0;
                              }
                            }
                          } else {
                            return 0;
                          }
                        }
                      } else {
                        if (obs[2] <= -0.316667) {
                          return 2;
                        } else {
                          return 1;
                        }
                      }
                    } else {
                      if (obs[125] <= 0.500000) {
                        if (obs[7] <= -3.300000) {
                          return 0;
                        } else {
                          return 0;
                        }
                      } else {
                        if (obs[98] <= 0.025000) {
                          if (obs[123] <= 0.125000) {
                            return 0;
                          } else {
                            return 6;
                          }
                        } else {
                          return 1;
                        }
                      }
                    }
                  }
                } else {
                  if (obs[120] <= 1.500000) {
                    if (obs[24] <= 0.500000) {
                      if (obs[25] <= 0.500000) {
                        if (obs[23] <= 0.500000) {
                          if (obs[105] <= 0.500000) {
                            if (obs[2] <= -0.150000) {
                              return 3;
                            } else {
                              return 4;
                            }
                          } else {
                            if (obs[0] <= 0.575000) {
                              return 4;
                            } else {
                              return 1;
                            }
                          }
                        } else {
                          return 6;
                        }
                      } else {
                        return 6;
                      }
                    } else {
                      return 6;
                    }
                  } else {
                    if (obs[19] <= 0.500000) {
                      return 0;
                    } else {
                      return 4;
                    }
                  }
                }
              } else {
                if (obs[5] <= 0.925000) {
                  if (obs[97] <= 0.500000) {
                    if (obs[71] <= 0.750000) {
                      if (obs[131] <= 0.500000) {
                        if (obs[71] <= 0.350000) {
                          return 1;
                        } else {
                          return 1;
                        }
                      } else {
                        return 4;
                      }
                    } else {
                      if (obs[149] <= 0.500000) {
                        return 1;
                      } else {
                        return 6;
                      }
                    }
                  } else {
                    return 1;
                  }
                } else {
                  if (obs[46] <= 0.500000) {
                    if (obs[20] <= 0.500000) {
                      if (obs[16] <= 0.500000) {
                        if (obs[17] <= 0.500000) {
                          if (obs[15] <= 0.500000) {
                            if (obs[19] <= 0.500000) {
                              if (obs[26] <= 0.500000) {
                                if (obs[12] <= 0.500000) {
                                  if (obs[13] <= 0.500000) {
                                    if (obs[11] <= 0.500000) {
                                      if (obs[38] <= 0.500000) {
                                        if (obs[47] <= 0.500000) {
                                          if (obs[150] <= 0.500000) {
                                            if (obs[40] <= 0.500000) {
                                              if (obs[59] <= 0.575000) {
                                                return 1;
                                              } else {
                                                if (obs[52] <= 0.450000) {
                                                  if (obs[27] <= 0.500000) {
                                                    if (obs[32] <= 0.500000) {
                                                      return 1;
                                                    } else {
                                                      return 5;
                                                    }
                                                  } else {
                                                    return 5;
                                                  }
                                                } else {
                                                  return 5;
                                                }
                                              }
                                            } else {
                                              return 1;
                                            }
                                          } else {
                                            return 5;
                                          }
                                        } else {
                                          return 5;
                                        }
                                      } else {
                                        return 5;
                                      }
                                    } else {
                                      if (obs[71] <= 0.250000) {
                                        return 5;
                                      } else {
                                        return 1;
                                      }
                                    }
                                  } else {
                                    if (obs[36] <= 0.500000) {
                                      if (obs[71] <= 0.150000) {
                                        return 5;
                                      } else {
                                        return 0;
                                      }
                                    } else {
                                      return 0;
                                    }
                                  }
                                } else {
                                  if (obs[71] <= 0.150000) {
                                    return 5;
                                  } else {
                                    return 5;
                                  }
                                }
                              } else {
                                if (obs[71] <= 0.150000) {
                                  return 5;
                                } else {
                                  if (obs[150] <= 0.500000) {
                                    return 5;
                                  } else {
                                    return 5;
                                  }
                                }
                              }
                            } else {
                              if (obs[26] <= 0.500000) {
                                return 1;
                              } else {
                                return 5;
                              }
                            }
                          } else {
                            if (obs[47] <= 0.500000) {
                              if (obs[26] <= 0.500000) {
                                return 0;
                              } else {
                                return 5;
                              }
                            } else {
                              return 5;
                            }
                          }
                        } else {
                          if (obs[102] <= 0.500000) {
                            if (obs[26] <= 0.500000) {
                              return 0;
                            } else {
                              return 5;
                            }
                          } else {
                            return 1;
                          }
                        }
                      } else {
                        if (obs[26] <= 0.500000) {
                          return 1;
                        } else {
                          if (obs[59] <= 0.725000) {
                            return 1;
                          } else {
                            return 3;
                          }
                        }
                      }
                    } else {
                      return 1;
                    }
                  } else {
                    if (obs[71] <= 0.250000) {
                      return 5;
                    } else {
                      return 5;
                    }
                  }
                }
              }
            } else {
              if (obs[79] <= 0.500000) {
                if (obs[134] <= 0.025000) {
                  if (obs[105] <= 0.500000) {
                    if (obs[120] <= 0.500000) {
                      if (obs[13] <= 0.500000) {
                        if (obs[17] <= 0.500000) {
                          if (obs[15] <= 0.500000) {
                            if (obs[150] <= 0.500000) {
                              if (obs[5] <= 0.325000) {
                                return 1;
                              } else {
                                if (obs[11] <= 0.500000) {
                                  if (obs[71] <= 0.550000) {
                                    if (obs[128] <= 0.500000) {
                                      return 1;
                                    } else {
                                      return 4;
                                    }
                                  } else {
                                    return 0;
                                  }
                                } else {
                                  return 0;
                                }
                              }
                            } else {
                              if (obs[96] <= 0.100000) {
                                if (obs[126] <= 0.500000) {
                                  return 5;
                                } else {
                                  return 0;
                                }
                              } else {
                                return 1;
                              }
                            }
                          } else {
                            return 0;
                          }
                        } else {
                          if (obs[111] <= 0.025000) {
                            return 0;
                          } else {
                            return 0;
                          }
                        }
                      } else {
                        return 0;
                      }
                    } else {
                      return 0;
                    }
                  } else {
                    if (obs[21] <= 0.500000) {
                      return 1;
                    } else {
                      return 1;
                    }
                  }
                } else {
                  if (obs[26] <= 0.500000) {
                    if (obs[151] <= 0.250000) {
                      if (obs[7] <= -0.483333) {
                        return 5;
                      } else {
                        if (obs[27] <= 0.500000) {
                          if (obs[105] <= 0.500000) {
                            return 4;
                          } else {
                            return 1;
                          }
                        } else {
                          return 4;
                        }
                      }
                    } else {
                      return 0;
                    }
                  } else {
                    if (obs[7] <= -1.133333) {
                      return 5;
                    } else {
                      return 4;
                    }
                  }
                }
              } else {
                if (obs[2] <= -0.050000) {
                  return 0;
                } else {
                  if (obs[12] <= 0.500000) {
                    if (obs[128] <= 0.500000) {
                      if (obs[7] <= -4.300000) {
                        return 0;
                      } else {
                        if (obs[7] <= 0.416667) {
                          return 0;
                        } else {
                          return 0;
                        }
                      }
                    } else {
                      return 0;
                    }
                  } else {
                    if (obs[115] <= 0.500000) {
                      return 0;
                    } else {
                      return 1;
                    }
                  }
                }
              }
            }
          } else {
            if (obs[24] <= 0.500000) {
              if (obs[23] <= 0.500000) {
                if (obs[25] <= 0.500000) {
                  if (obs[109] <= 0.500000) {
                    if (obs[113] <= 0.500000) {
                      if (obs[17] <= 0.500000) {
                        if (obs[39] <= 0.500000) {
                          if (obs[96] <= 0.100000) {
                            return 5;
                          } else {
                            if (obs[7] <= -0.683333) {
                              return 5;
                            } else {
                              if (obs[151] <= 0.550000) {
                                if (obs[49] <= 0.500000) {
                                  return 5;
                                } else {
                                  return 4;
                                }
                              } else {
                                return 5;
                              }
                            }
                          }
                        } else {
                          return 5;
                        }
                      } else {
                        if (obs[96] <= 0.100000) {
                          return 0;
                        } else {
                          if (obs[151] <= 1.050000) {
                            if (obs[7] <= -0.750000) {
                              return 5;
                            } else {
                              return 4;
                            }
                          } else {
                            return 5;
                          }
                        }
                      }
                    } else {
                      if (obs[12] <= 0.500000) {
                        if (obs[78] <= 0.500000) {
                          if (obs[39] <= 0.500000) {
                            return 4;
                          } else {
                            return 5;
                          }
                        } else {
                          return 0;
                        }
                      } else {
                        if (obs[91] <= 0.500000) {
                          return 4;
                        } else {
                          return 1;
                        }
                      }
                    }
                  } else {
                    if (obs[106] <= 0.500000) {
                      return 0;
                    } else {
                      if (obs[17] <= 0.500000) {
                        if (obs[7] <= -0.616667) {
                          return 5;
                        } else {
                          if (obs[39] <= 0.500000) {
                            if (obs[27] <= 0.500000) {
                              return 5;
                            } else {
                              if (obs[78] <= 0.500000) {
                                return 4;
                              } else {
                                return 5;
                              }
                            }
                          } else {
                            return 5;
                          }
                        }
                      } else {
                        return 4;
                      }
                    }
                  }
                } else {
                  if (obs[52] <= 0.650000) {
                    return 6;
                  } else {
                    return 6;
                  }
                }
              } else {
                if (obs[79] <= 0.500000) {
                  return 6;
                } else {
                  if (obs[7] <= -0.283333) {
                    return 5;
                  } else {
                    return 4;
                  }
                }
              }
            } else {
              if (obs[12] <= 0.500000) {
                return 6;
              } else {
                return 5;
              }
            }
          }
        }
      }
    }
  } else {
    if (obs[2] <= -0.216667) {
      if (obs[3] <= 0.166667) {
        if (obs[70] <= 0.500000) {
          return 0;
        } else {
          return 1;
        }
      } else {
        if (obs[5] <= 0.625000) {
          if (obs[2] <= -0.883333) {
            return 0;
          } else {
            return 1;
          }
        } else {
          if (obs[13] <= 0.500000) {
            if (obs[52] <= 1.250000) {
              return 1;
            } else {
              return 0;
            }
          } else {
            return 0;
          }
        }
      }
    } else {
      if (obs[132] <= 0.100000) {
        if (obs[46] <= 0.500000) {
          if (obs[2] <= 0.250000) {
            if (obs[149] <= 0.500000) {
              if (obs[3] <= 0.166667) {
                return 0;
              } else {
                return 1;
              }
            } else {
              return 0;
            }
          } else {
            if (obs[71] <= 1.150000) {
              if (obs[6] <= 0.450000) {
                return 1;
              } else {
                return 1;
              }
            } else {
              return 1;
            }
          }
        } else {
          if (obs[150] <= 0.500000) {
            return 1;
          } else {
            return 0;
          }
        }
      } else {
        if (obs[46] <= 0.500000) {
          if (obs[3] <= 0.166667) {
            return 0;
          } else {
            if (obs[13] <= 0.500000) {
              if (obs[2] <= 0.116667) {
                if (obs[5] <= 0.925000) {
                  return 1;
                } else {
                  return 1;
                }
              } else {
                return 1;
              }
            } else {
              if (obs[52] <= 0.450000) {
                if (obs[0] <= 0.925000) {
                  return 1;
                } else {
                  return 1;
                }
              } else {
                if (obs[50] <= 0.500000) {
                  return 1;
                } else {
                  return 0;
                }
              }
            }
          }
        } else {
          if (obs[13] <= 0.500000) {
            if (obs[70] <= 0.500000) {
              if (obs[2] <= 0.450000) {
                return 1;
              } else {
                if (obs[150] <= 0.500000) {
                  return 1;
                } else {
                  if (obs[5] <= 0.775000) {
                    return 1;
                  } else {
                    return 1;
                  }
                }
              }
            } else {
              if (obs[151] <= 0.650000) {
                if (obs[152] <= 0.150000) {
                  return 1;
                } else {
                  return 1;
                }
              } else {
                return 1;
              }
            }
          } else {
            return 0;
          }
        }
      }
    }
  }
}

export const DT_N_FEATURES = 153;
